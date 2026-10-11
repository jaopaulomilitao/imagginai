import AFRAME, { type Component, type Entity } from 'aframe';
import type { Mesh, Vector3 } from 'three';

import {
  type HandDataDetail,
  type HandLandmarks,
  type Landmark,
  LANDMARK_COUNT,
} from '../core/landmarks';
import { getInteracxrSystem } from './interacxr-system';
import { THREE } from './three';

interface HandModelData {
  source: Entity | null;
  jointRadius: number;
  jointSmoothing: number;
  boneRadius: number;
}

export interface HandModelComponent extends Component<HandModelData> {
  controller?: HandModelController;
}

// pares de índices que formam os ossos de cada dedo
const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

export class HandModelController {
  private readonly joints: Mesh[] = [];
  private readonly bones: Mesh[] = [];
  private readonly targets: Vector3[] = [];
  private handVisible = false;
  private readonly tmpMid = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  private readonly onHandData = (event: Event): void => {
    this.handleHandData((event as CustomEvent<HandDataDetail>).detail.landmarks);
  };

  constructor(
    private readonly el: Entity,
    private readonly data: HandModelData,
  ) {
    this.createJoints();
    this.createBones();
    data.source?.addEventListener('ixr-hand-data', this.onHandData);
  }

  dispose(): void {
    this.data.source?.removeEventListener('ixr-hand-data', this.onHandData);
  }

  tick(): void {
    if (!this.handVisible) return;
    this.joints.forEach((joint, i) => {
      joint.visible = true;
      const target = this.targets[i];
      if (target) joint.position.lerp(target, this.data.jointSmoothing);
    });
    HAND_CONNECTIONS.forEach(([from, to], i) =>
      this.placeBone(this.bones[i], this.joints[from], this.joints[to]),
    );
  }

  private createJoints(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const geometry = new THREE.SphereGeometry(this.data.jointRadius, 12, 12);
      const joint = new THREE.Mesh(geometry, material);
      joint.visible = false;
      this.el.object3D.add(joint);
      this.joints.push(joint);
      this.targets.push(new THREE.Vector3());
    }
  }

  private createBones(): void {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const radius = this.data.boneRadius;
    for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
      const bone = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 8), material);
      bone.visible = false;
      this.el.object3D.add(bone);
      this.bones.push(bone);
    }
  }

  private placeBone(bone: Mesh | undefined, a: Mesh | undefined, b: Mesh | undefined): void {
    if (!bone || !a || !b) return;
    bone.visible = true;
    this.tmpMid.addVectors(a.position, b.position).multiplyScalar(0.5);
    bone.position.copy(this.tmpMid);
    this.tmpDir.subVectors(b.position, a.position);
    bone.scale.set(1, this.tmpDir.length(), 1);
    bone.quaternion.setFromUnitVectors(this.up, this.tmpDir.normalize());
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
      this.bones.forEach((bone) => (bone.visible = false));
      this.targets.forEach((target) => target.set(0, 0, 0));
      return;
    }
    this.handVisible = true;
    hand.forEach((landmark, i) => this.targets[i]?.copy(this.mapPoint(landmark)));
  }
}

AFRAME.registerComponent<HandModelComponent>('ixr-hand-model', {
  schema: {
    source: { type: 'selector' },
    jointRadius: { type: 'number', default: 0.012 },
    jointSmoothing: { type: 'number', default: 0.35 },
    boneRadius: { type: 'number', default: 0.004 },
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
