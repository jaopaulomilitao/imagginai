import AFRAME, { type Component, type Entity } from 'aframe';
import type { Group, Mesh, MeshBasicMaterial, Vector3, WebGLRenderer } from 'three';

import {
  type HandDataDetail,
  type HandLandmarks,
  LANDMARK,
  LANDMARK_COUNT,
} from '../core/landmarks';
import { detectStereoEyeSign } from '../passthrough/passthrough-layer';
import { getInteracxrSystem } from './interacxr-system';
import { HAND_DATA_EVENT } from './ixr-hand-tracking';
import { THREE } from './three';

export type HandVisualStyle = 'classic' | 'stylized';

export const HAND_STYLE_STORAGE_KEY = 'imx-hand-style';
export const HAND_STYLE_CHANGE_EVENT = 'imx-hand-style-change';

interface HandModelData {
  source: Entity | null;
  handStyle: HandVisualStyle;
  jointRadius: number;
  boneRadius: number;
  jointSmoothing: number;
}

export interface HandModelComponent extends Component<HandModelData> {
  controller?: HandModelController;
}

// conexões anatômicas completas dos 21 pontos da mão no mediapipe (idênticas nas versões clássica e estilizada)
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
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

// índices das esferas visíveis no modo estilizado: apenas base (punho) e pontas dos 5 dedos
export const STYLIZED_SPHERE_LANDMARK_SET: ReadonlySet<number> = new Set([
  LANDMARK.WRIST, // 0
  LANDMARK.THUMB_TIP, // 4
  LANDMARK.INDEX_TIP, // 8
  LANDMARK.MIDDLE_TIP, // 12
  LANDMARK.RING_TIP, // 16
  LANDMARK.PINKY_TIP, // 20
]);

const Y_UNIT_VECTOR = new THREE.Vector3(0, 1, 0);
const MAX_RENDERED_HANDS = 2;

interface HandMeshSlot {
  readonly joints: Mesh[];
  readonly bones: Mesh[];
  readonly positions: Vector3[];
  readonly targets: Vector3[];
  visible: boolean;
}

function resolveInitialHandStyle(fallback: HandVisualStyle): HandVisualStyle {
  try {
    const stored = localStorage.getItem(HAND_STYLE_STORAGE_KEY);
    if (stored === 'classic' || stored === 'stylized') {
      return stored;
    }
  } catch {
    // ignora caso localStorage não esteja disponível
  }
  return fallback === 'classic' ? 'classic' : 'stylized';
}

// renderiza até duas mãos simultaneamente em 3d nos modos clássico (21 esferas + 20 linhas) ou estilizado (6 esferas nas pontas/base + 20 linhas) com blend mode difference
export class HandModelController {
  private readonly group: Group;
  private readonly slots: HandMeshSlot[] = [];
  private readonly sharedMaterial: MeshBasicMaterial;
  private readonly tmpViewport = new THREE.Vector4();
  private readonly tmpSize = new THREE.Vector2();
  private readonly tmpStart = new THREE.Vector3();
  private readonly tmpEnd = new THREE.Vector3();
  private readonly tmpMidpoint = new THREE.Vector3();
  private readonly tmpDirection = new THREE.Vector3();
  private currentStyle: HandVisualStyle;

  private readonly onHandData = (event: Event): void => {
    this.handleHandData((event as CustomEvent<HandDataDetail>).detail);
  };

  private readonly onStyleChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ style?: HandVisualStyle }>).detail;
    if (detail?.style === 'classic' || detail?.style === 'stylized') {
      this.setHandStyle(detail.style);
    }
  };

  constructor(
    private readonly el: Entity,
    private readonly data: HandModelData,
  ) {
    this.currentStyle = resolveInitialHandStyle(data.handStyle);
    this.group = new THREE.Group();
    this.el.object3D.add(this.group);

    // modo de mesclagem difference (inversão cromática) para visibilidade sobre fundos claros e escuros
    this.sharedMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 1.0,
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
    });

    const attachStereo = (mesh: Mesh): void => {
      mesh.onBeforeRender = (renderer: WebGLRenderer): void => {
        const system = getInteracxrSystem(this.el);
        const eyeSign = detectStereoEyeSign(renderer, this.tmpViewport, this.tmpSize);
        this.group.position.x = eyeSign * system.calibration.stereoOffsetM;
        this.group.updateMatrix();
        if (this.group.parent) {
          this.group.matrixWorld.multiplyMatrices(this.group.parent.matrixWorld, this.group.matrix);
        }
        mesh.updateMatrix();
        mesh.matrixWorld.multiplyMatrices(this.group.matrixWorld, mesh.matrix);
      };
    };

    for (let h = 0; h < MAX_RENDERED_HANDS; h++) {
      const slot: HandMeshSlot = {
        joints: [],
        bones: [],
        positions: [],
        targets: [],
        visible: false,
      };

      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const geometry = new THREE.SphereGeometry(data.jointRadius, 12, 12);
        const joint = new THREE.Mesh(geometry, this.sharedMaterial);
        joint.renderOrder = 999;
        joint.visible = false;
        attachStereo(joint);
        this.group.add(joint);
        slot.joints.push(joint);
        slot.positions.push(new THREE.Vector3());
        slot.targets.push(new THREE.Vector3());
      }

      for (let i = 0; i < HAND_CONNECTIONS.length; i++) {
        const cylinderGeom = new THREE.CylinderGeometry(data.boneRadius, data.boneRadius, 1, 8);
        const bone = new THREE.Mesh(cylinderGeom, this.sharedMaterial);
        bone.renderOrder = 998;
        bone.visible = false;
        attachStereo(bone);
        this.group.add(bone);
        slot.bones.push(bone);
      }

      this.slots.push(slot);
    }

    data.source?.addEventListener(HAND_DATA_EVENT, this.onHandData);
    if (typeof window !== 'undefined') {
      window.addEventListener(HAND_STYLE_CHANGE_EVENT, this.onStyleChange);
    }
  }

  getHandStyle(): HandVisualStyle {
    return this.currentStyle;
  }

  getActiveHandCount(): number {
    return this.slots.filter((slot) => slot.visible).length;
  }

  setHandStyle(style: HandVisualStyle): void {
    this.currentStyle = style;
    try {
      localStorage.setItem(HAND_STYLE_STORAGE_KEY, style);
    } catch {
      // ignora caso localStorage não esteja disponível
    }
  }

  dispose(): void {
    this.data.source?.removeEventListener(HAND_DATA_EVENT, this.onHandData);
    if (typeof window !== 'undefined') {
      window.removeEventListener(HAND_STYLE_CHANGE_EVENT, this.onStyleChange);
    }
    this.hideAll();
    for (const slot of this.slots) {
      for (const joint of slot.joints) {
        joint.geometry.dispose();
        joint.removeFromParent();
      }
      for (const bone of slot.bones) {
        bone.geometry.dispose();
        bone.removeFromParent();
      }
      slot.joints.length = 0;
      slot.bones.length = 0;
      slot.positions.length = 0;
      slot.targets.length = 0;
    }
    this.slots.length = 0;
    this.sharedMaterial.dispose();
    this.group.removeFromParent();
  }

  private isSphereVisibleForLandmark(index: number): boolean {
    if (this.currentStyle === 'stylized') {
      return STYLIZED_SPHERE_LANDMARK_SET.has(index);
    }
    return true;
  }

  private getSphereScaleForLandmark(index: number): number {
    if (this.currentStyle === 'stylized') {
      return index === LANDMARK.WRIST ? 1.35 : 1.2;
    }
    return 1.0;
  }

  tick(): void {
    const smoothing = this.data.jointSmoothing;
    for (const slot of this.slots) {
      if (!slot.visible) continue;
      this.tickSlot(slot, smoothing);
    }
  }

  private tickSlot(slot: HandMeshSlot, smoothing: number): void {
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const pos = slot.positions[i];
      const target = slot.targets[i];
      const joint = slot.joints[i];
      if (!pos || !target || !joint) continue;

      pos.lerp(target, smoothing);
      const showSphere = this.isSphereVisibleForLandmark(i);
      joint.visible = showSphere;
      if (showSphere) {
        const s = this.getSphereScaleForLandmark(i);
        joint.position.copy(pos);
        joint.scale.setScalar(s);
      }
    }

    for (let b = 0; b < HAND_CONNECTIONS.length; b++) {
      const pair = HAND_CONNECTIONS[b];
      const bone = slot.bones[b];
      if (!pair || !bone) continue;
      const idxA = pair[0];
      const idxB = pair[1];
      const pA = slot.positions[idxA];
      const pB = slot.positions[idxB];
      if (!pA || !pB) continue;

      const fullDist = pA.distanceTo(pB);
      if (fullDist <= 0.001) {
        bone.visible = false;
        continue;
      }

      this.tmpDirection.subVectors(pB, pA).divideScalar(fullDist);

      // recorta as extremidades do cilindro na borda exata das esferas ativas para evitar dupla inversão no blend difference
      const trimA = this.isSphereVisibleForLandmark(idxA)
        ? this.data.jointRadius * this.getSphereScaleForLandmark(idxA) * 0.92
        : 0;
      const trimB = this.isSphereVisibleForLandmark(idxB)
        ? this.data.jointRadius * this.getSphereScaleForLandmark(idxB) * 0.92
        : 0;

      const trimmedDist = fullDist - trimA - trimB;
      if (trimmedDist > 0.0008) {
        this.tmpStart.copy(pA).addScaledVector(this.tmpDirection, trimA);
        this.tmpEnd.copy(pB).addScaledVector(this.tmpDirection, -trimB);
        this.tmpMidpoint.addVectors(this.tmpStart, this.tmpEnd).multiplyScalar(0.5);
        bone.position.copy(this.tmpMidpoint);
        bone.scale.set(1, trimmedDist, 1);
        bone.quaternion.setFromUnitVectors(Y_UNIT_VECTOR, this.tmpDirection);
        bone.visible = true;
      } else {
        bone.visible = false;
      }
    }
  }

  private handleHandData(detail: HandDataDetail | undefined): void {
    const rawHands: HandLandmarks[] =
      detail?.hands && detail.hands.length > 0
        ? detail.hands.map((h) => h.landmarks)
        : detail?.landmarks
          ? [detail.landmarks]
          : [];

    if (rawHands.length === 0) {
      this.hideAll();
      return;
    }

    // ordena horizontalmente pelo punho quando há mais de uma mão para evitar troca abrupta de slots entre frames
    const orderedHands =
      rawHands.length >= 2
        ? [...rawHands].sort((a, b) => (a[LANDMARK.WRIST]?.x ?? 0) - (b[LANDMARK.WRIST]?.x ?? 0))
        : rawHands;

    const system = getInteracxrSystem(this.el);

    for (let s = 0; s < this.slots.length; s++) {
      const slot = this.slots[s];
      if (!slot) continue;
      const hand = orderedHands[s] ?? null;
      if (!hand || hand.length === 0) {
        this.hideSlot(slot);
        continue;
      }

      const wasHidden = !slot.visible;
      slot.visible = true;

      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const landmark = hand[i];
        if (landmark) {
          const { x, y, z } = system.calibration.mapLandmark(landmark, system.projectionPlane);
          slot.targets[i]?.set(x, y, z);
          if (wasHidden) {
            slot.positions[i]?.set(x, y, z);
          }
        }
      }
    }
  }

  private hideSlot(slot: HandMeshSlot): void {
    if (!slot.visible) return;
    slot.visible = false;
    for (const joint of slot.joints) {
      joint.visible = false;
    }
    for (const bone of slot.bones) {
      bone.visible = false;
    }
    for (const pos of slot.positions) {
      pos.set(0, 0, 0);
    }
    for (const target of slot.targets) {
      target.set(0, 0, 0);
    }
  }

  private hideAll(): void {
    for (const slot of this.slots) {
      this.hideSlot(slot);
    }
  }
}

AFRAME.registerComponent<HandModelComponent>('ixr-hand-model', {
  schema: {
    source: { type: 'selector' },
    handStyle: { type: 'string', default: 'stylized' },
    jointRadius: { type: 'number', default: 0.012 },
    boneRadius: { type: 'number', default: 0.004 },
    jointSmoothing: { type: 'number', default: 0.3 },
  },
  init() {
    this.controller = new HandModelController(this.el, this.data);
  },
  update() {
    if (this.data.handStyle === 'classic' || this.data.handStyle === 'stylized') {
      this.controller?.setHandStyle(this.data.handStyle);
    }
  },
  tick() {
    this.controller?.tick();
  },
  remove() {
    this.controller?.dispose();
  },
});
