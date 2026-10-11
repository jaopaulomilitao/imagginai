import AFRAME, { type Component, type Entity } from 'aframe';

import type { PlanePoint } from '../calibration/calibration-profile';
import {
  type HandDataDetail,
  type HandLandmarks,
  type Landmark,
  LANDMARK,
} from '../core/landmarks';
import {
  DEFAULT_POSE_CLASSIFIER_CONFIG,
  type PoseEvent,
  PoseClassifier,
  type PoseName,
} from '../core/pose-classifier';
import { getInteracxrSystem } from './interacxr-system';
import { HAND_DATA_EVENT } from './ixr-hand-tracking';

interface GestureDetectorData {
  source: Entity | null;
  pinchStartRatio: number;
  pinchEndRatio: number;
  confirmFrames: number;
}

export interface GestureDetectorComponent extends Component<GestureDetectorData> {
  controller?: GestureDetectorController;
}

export interface PosePayload {
  // posição no espaço da câmera, sobre o plano de projeção calibrado
  position: PlanePoint;
  handSize: number;
}

export const HAND_LOST_EVENT = 'ixr-hand-lost';

function landmarkAt(hand: HandLandmarks, index: number): Landmark {
  return hand[index] ?? { x: 0.5, y: 0.5, z: 0 };
}

// ponto de referência de cada pose: punho para o punho fechado, centro da pinça para a pinça
function anchorFor(pose: PoseName, hand: HandLandmarks): Landmark {
  if (pose === 'grab') return landmarkAt(hand, LANDMARK.WRIST);
  const indexTip = landmarkAt(hand, LANDMARK.INDEX_TIP);
  if (pose !== 'pinch') return indexTip;
  const thumbTip = landmarkAt(hand, LANDMARK.THUMB_TIP);
  return {
    x: (thumbTip.x + indexTip.x) / 2,
    y: (thumbTip.y + indexTip.y) / 2,
    z: (thumbTip.z + indexTip.z) / 2,
  };
}

export class GestureDetectorController {
  private readonly classifier: PoseClassifier;
  private lastLandmarks: HandLandmarks | null = null;
  private lastHandSize = 0;

  private readonly onHandData = (event: Event): void => {
    const detail = (event as CustomEvent<HandDataDetail>).detail;
    this.handleHandData(detail.landmarks, detail.timestampMs);
  };

  constructor(
    private readonly el: Entity,
    private readonly data: GestureDetectorData,
  ) {
    this.classifier = new PoseClassifier({
      ...DEFAULT_POSE_CLASSIFIER_CONFIG,
      pinchStartRatio: data.pinchStartRatio,
      pinchEndRatio: data.pinchEndRatio,
      confirmFrames: data.confirmFrames,
    });
    data.source?.addEventListener(HAND_DATA_EVENT, this.onHandData);
  }

  dispose(): void {
    this.data.source?.removeEventListener(HAND_DATA_EVENT, this.onHandData);
  }

  private handleHandData(hand: HandLandmarks | null, timestampMs: number): void {
    const update = this.classifier.update(hand, timestampMs);
    // durante uma falha curta de rastreamento, os eventos usam o último quadro válido
    if (update.landmarks) this.lastLandmarks = update.landmarks;
    if (update.metrics) this.lastHandSize = update.metrics.handSize;
    update.events.forEach((event) => this.emitPose(event));
    if (update.handLost) this.el.emit(HAND_LOST_EVENT);
  }

  private emitPose({ pose, phase }: PoseEvent): void {
    const hand = this.lastLandmarks;
    if (!hand) return;
    const system = getInteracxrSystem(this.el);
    const position = system.calibration.mapLandmark(anchorFor(pose, hand), system.projectionPlane);
    const payload: PosePayload = { position, handSize: this.lastHandSize };
    this.el.emit(`ixr-${pose}-${phase}`, payload);
  }
}

AFRAME.registerComponent<GestureDetectorComponent>('ixr-gesture-detector', {
  schema: {
    source: { type: 'selector', default: '#main-camera' },
    pinchStartRatio: { type: 'number', default: DEFAULT_POSE_CLASSIFIER_CONFIG.pinchStartRatio },
    pinchEndRatio: { type: 'number', default: DEFAULT_POSE_CLASSIFIER_CONFIG.pinchEndRatio },
    confirmFrames: { type: 'int', default: DEFAULT_POSE_CLASSIFIER_CONFIG.confirmFrames },
  },
  init() {
    this.controller = new GestureDetectorController(this.el, this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
