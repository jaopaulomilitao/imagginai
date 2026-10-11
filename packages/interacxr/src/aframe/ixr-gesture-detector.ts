import AFRAME, { type Component, type Entity } from 'aframe';

import {
  type HandDataDetail,
  type HandLandmarks,
  type Landmark,
  LANDMARK,
} from '../core/landmarks';
import { getInteracxrSystem } from './interacxr-system';

interface GestureDetectorData {
  source: Entity | null;
}

export interface GestureDetectorComponent extends Component<GestureDetectorData> {
  controller?: GestureDetectorController;
}

type PoseName = 'grab' | 'victory' | 'rock' | 'point' | 'pinch';

interface Vector3Like {
  x: number;
  y: number;
  z: number;
}

interface PosePayload {
  position: Vector3Like;
  handSize: number;
}

const PINCH_START_DISTANCE = 0.04;
const PINCH_END_DISTANCE = 0.06;

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function landmarkAt(hand: HandLandmarks, index: number): Landmark {
  const landmark = hand[index];
  if (!landmark) throw new Error(`landmark ${index} missing`);
  return landmark;
}

export class GestureDetectorController {
  private readonly states: Record<PoseName, boolean> = {
    grab: false,
    victory: false,
    rock: false,
    point: false,
    pinch: false,
  };

  private readonly onHandData = (event: Event): void => {
    this.handleHandData((event as CustomEvent<HandDataDetail>).detail.landmarks);
  };

  constructor(
    private readonly el: Entity,
    private readonly source: Entity | null,
  ) {
    source?.addEventListener('ixr-hand-data', this.onHandData);
  }

  dispose(): void {
    this.source?.removeEventListener('ixr-hand-data', this.onHandData);
  }

  private emitPose(name: PoseName, state: boolean, payload: PosePayload): void {
    if (state && !this.states[name]) {
      this.states[name] = true;
      this.el.emit(`ixr-${name}-start`, payload);
    } else if (state && this.states[name]) {
      this.el.emit(`ixr-${name}-move`, payload);
    } else if (!state && this.states[name]) {
      this.states[name] = false;
      this.el.emit(`ixr-${name}-end`, payload);
    }
  }

  private reset(): void {
    for (const pose of Object.keys(this.states) as PoseName[]) {
      if (this.states[pose]) {
        this.states[pose] = false;
        this.el.emit(`ixr-${pose}-end`);
      }
    }
    this.el.emit('ixr-hand-lost');
  }

  // é usado o mesmo plano de projeção do vídeo e do modelo da mão (calibração unificada)
  private getWorldPosition(landmark: Landmark): Vector3Like {
    const system = getInteracxrSystem(this.el);
    return system.calibration.mapLandmark(landmark, system.projectionPlane);
  }

  private isExtended(hand: HandLandmarks, tip: number, pip: number): boolean {
    const wrist = landmarkAt(hand, LANDMARK.WRIST);
    return distance(landmarkAt(hand, tip), wrist) > distance(landmarkAt(hand, pip), wrist);
  }

  private handleHandData(hand: HandLandmarks | null): void {
    if (!hand) {
      this.reset();
      return;
    }
    const wrist = landmarkAt(hand, LANDMARK.WRIST);
    const middleMcp = landmarkAt(hand, LANDMARK.MIDDLE_MCP);
    const handSize = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);

    const index = this.isExtended(hand, LANDMARK.INDEX_TIP, LANDMARK.INDEX_PIP);
    const middle = this.isExtended(hand, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_PIP);
    const ring = this.isExtended(hand, LANDMARK.RING_TIP, LANDMARK.RING_PIP);
    const pinky = this.isExtended(hand, LANDMARK.PINKY_TIP, LANDMARK.PINKY_PIP);

    const grab = !index && !middle && !ring && !pinky;
    const victory = index && middle && !ring && !pinky;
    const rock = index && pinky && !middle && !ring;
    const pointing = index && !middle && !ring && !pinky;
    const pinch = this.nextPinchState(hand, grab || rock);

    const thumbTip = landmarkAt(hand, LANDMARK.THUMB_TIP);
    const indexTip = landmarkAt(hand, LANDMARK.INDEX_TIP);
    const pinchCenter = {
      x: (thumbTip.x + indexTip.x) / 2,
      y: (thumbTip.y + indexTip.y) / 2,
      z: (thumbTip.z + indexTip.z) / 2,
    };

    this.emitPose('grab', grab, { position: this.getWorldPosition(wrist), handSize });
    this.emitPose('victory', victory, { position: this.getWorldPosition(indexTip), handSize });
    this.emitPose('rock', rock, { position: this.getWorldPosition(indexTip), handSize });
    this.emitPose('point', pointing, { position: this.getWorldPosition(indexTip), handSize });
    this.emitPose('pinch', pinch, { position: this.getWorldPosition(pinchCenter), handSize });
  }

  private nextPinchState(hand: HandLandmarks, blocked: boolean): boolean {
    if (blocked) return false;
    const thumbTip = landmarkAt(hand, LANDMARK.THUMB_TIP);
    const pinchDistance = distance(thumbTip, landmarkAt(hand, LANDMARK.INDEX_TIP));
    // é aplicada histerese para evitar oscilação perto do limiar
    if (!this.states.pinch && pinchDistance < PINCH_START_DISTANCE) return true;
    if (this.states.pinch && pinchDistance > PINCH_END_DISTANCE) return false;
    return this.states.pinch;
  }
}

AFRAME.registerComponent<GestureDetectorComponent>('ixr-gesture-detector', {
  schema: {
    source: { type: 'selector', default: '#main-camera' },
  },
  init() {
    this.controller = new GestureDetectorController(this.el, this.data.source);
  },
  remove() {
    this.controller?.dispose();
  },
});
