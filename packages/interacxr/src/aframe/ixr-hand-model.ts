import AFRAME, { type Component, type Entity } from 'aframe';
import type { Group, Mesh, Vector3, WebGLRenderer } from 'three';

import {
  type HandDataDetail,
  type HandLandmarks,
  type Landmark,
  LANDMARK,
} from '../core/landmarks';
import { detectStereoEyeSign } from '../passthrough/passthrough-layer';
import { getInteracxrSystem } from './interacxr-system';
import { HAND_DATA_EVENT } from './ixr-hand-tracking';
import { THREE } from './three';

interface HandModelData {
  source: Entity | null;
  jointRadius: number;
  jointSmoothing: number;
}

export interface HandModelComponent extends Component<HandModelData> {
  controller?: HandModelController;
}

// 6 nós anatômicos essenciais: punho e pontas dos 5 dedos (seção 3.3)
export const MINIMALIST_HAND_LANDMARK_INDICES: readonly number[] = [
  LANDMARK.WRIST, // 0
  LANDMARK.THUMB_TIP, // 4
  LANDMARK.INDEX_TIP, // 8
  LANDMARK.MIDDLE_TIP, // 12
  LANDMARK.RING_TIP, // 16
  LANDMARK.PINKY_TIP, // 20
];

export class HandModelController {
  private readonly handGroup: Group;
  private readonly joints: Mesh[] = [];
  private readonly targets: Vector3[] = [];
  private handVisible = false;
  private readonly tmpViewport = new THREE.Vector4();
  private readonly tmpSize = new THREE.Vector2();

  private readonly onHandData = (event: Event): void => {
    this.handleHandData((event as CustomEvent<HandDataDetail>).detail.landmarks);
  };

  constructor(
    private readonly el: Entity,
    private readonly data: HandModelData,
  ) {
    this.handGroup = new THREE.Group();
    this.el.object3D.add(this.handGroup);
    this.createJoints();
    data.source?.addEventListener(HAND_DATA_EVENT, this.onHandData);
  }

  dispose(): void {
    this.data.source?.removeEventListener(HAND_DATA_EVENT, this.onHandData);
    this.handGroup.removeFromParent();
  }

  tick(): void {
    if (!this.handVisible) return;
    this.joints.forEach((joint, i) => {
      joint.visible = true;
      const target = this.targets[i];
      if (target) joint.position.lerp(target, this.data.jointSmoothing);
    });
  }

  private attachStereoSync(mesh: Mesh): void {
    mesh.onBeforeRender = (renderer: WebGLRenderer): void => {
      const system = getInteracxrSystem(this.el);
      const eyeSign = detectStereoEyeSign(renderer, this.tmpViewport, this.tmpSize);
      this.handGroup.position.x = eyeSign * system.calibration.stereoOffsetM;
      this.handGroup.updateMatrix();
      if (this.handGroup.parent) {
        this.handGroup.matrixWorld.multiplyMatrices(
          this.handGroup.parent.matrixWorld,
          this.handGroup.matrix,
        );
      }
      mesh.updateMatrix();
      mesh.matrixWorld.multiplyMatrices(this.handGroup.matrixWorld, mesh.matrix);
    };
  }

  private createJoints(): void {
    // modo de mesclagem por diferença para contraste dinâmico garantido sobre fundos claros ou escuros (seção 3.3)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.ZeroFactor,
    });

    for (const landmarkIdx of MINIMALIST_HAND_LANDMARK_INDICES) {
      const isWrist = landmarkIdx === LANDMARK.WRIST;
      const radius = isWrist ? this.data.jointRadius * 1.3 : this.data.jointRadius;
      const geometry = new THREE.SphereGeometry(radius, 14, 14);
      const joint = new THREE.Mesh(geometry, material);
      joint.renderOrder = 999;
      joint.visible = false;
      this.attachStereoSync(joint);
      this.handGroup.add(joint);
      this.joints.push(joint);
      this.targets.push(new THREE.Vector3());
    }
  }

  // é usado o mesmo plano de projeção do vídeo (calibração unificada)
  private mapPoint(landmark: Landmark): Vector3 {
    const system = getInteracxrSystem(this.el);
    const { x, y, z } = system.calibration.mapLandmark(landmark, system.projectionPlane);
    return new THREE.Vector3(x, y, z);
  }

  private handleHandData(hand: HandLandmarks | null): void {
    if (!hand) {
      this.handVisible = false;
      this.joints.forEach((joint) => (joint.visible = false));
      this.targets.forEach((target) => target.set(0, 0, 0));
      return;
    }
    this.handVisible = true;
    MINIMALIST_HAND_LANDMARK_INDICES.forEach((landmarkIdx, i) => {
      const landmark = hand[landmarkIdx];
      if (landmark) {
        this.targets[i]?.copy(this.mapPoint(landmark));
      }
    });
  }
}

AFRAME.registerComponent<HandModelComponent>('ixr-hand-model', {
  schema: {
    source: { type: 'selector' },
    jointRadius: { type: 'number', default: 0.01 },
    jointSmoothing: { type: 'number', default: 0.35 },
  },
  init() {
    this.controller = new HandModelController(this.el, this.data);
  },
  tick() {
    this.controller?.tick();
  },
  remove() {
    this.controller?.dispose();
  },
});
