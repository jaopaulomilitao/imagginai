import AFRAME, { type Component, type Entity } from 'aframe';
import type { Group, Mesh, MeshBasicMaterial, Vector3, WebGLRenderer } from 'three';

import { type HandDataDetail, type HandLandmarks, LANDMARK } from '../core/landmarks';
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

const Y_UNIT_VECTOR = new THREE.Vector3(0, 1, 0);

// representação visual tridimensional de uma mão com esferas nos nós e cilindros conectores (seções 1 e 2)
class SingleHandVisual {
  readonly group: Group;
  private readonly joints: Mesh[] = [];
  private readonly bones: Mesh[] = [];
  private readonly targets: Vector3[] = [];
  private readonly tmpMidpoint = new THREE.Vector3();
  private readonly tmpDirection = new THREE.Vector3();
  private handVisible = false;

  constructor(
    private readonly ownerEl: Entity,
    private readonly jointRadius: number,
    material: MeshBasicMaterial,
    attachStereo: (mesh: Mesh, group: Group) => void,
  ) {
    this.group = new THREE.Group();

    // cria as 6 esferas (punho + 5 pontas dos dedos)
    for (const landmarkIdx of MINIMALIST_HAND_LANDMARK_INDICES) {
      const isWrist = landmarkIdx === LANDMARK.WRIST;
      const radius = isWrist ? this.jointRadius * 1.35 : this.jointRadius;
      const geometry = new THREE.SphereGeometry(radius, 14, 14);
      const joint = new THREE.Mesh(geometry, material);
      joint.renderOrder = 999;
      joint.visible = false;
      attachStereo(joint, this.group);
      this.group.add(joint);
      this.joints.push(joint);
      this.targets.push(new THREE.Vector3());
    }

    // cria os 5 cilindros conectores entre o punho (índice 0) e cada ponta de dedo (índices 1..5)
    // raio de 2.2 mm garante espessura tridimensional nítida no webgl sem colapso de linha (seção 2)
    const boneRadius = Math.max(0.002, this.jointRadius * 0.22);
    for (let i = 0; i < 5; i++) {
      const cylinderGeom = new THREE.CylinderGeometry(boneRadius, boneRadius, 1, 8);
      const bone = new THREE.Mesh(cylinderGeom, material);
      bone.renderOrder = 998;
      bone.visible = false;
      attachStereo(bone, this.group);
      this.group.add(bone);
      this.bones.push(bone);
    }
  }

  tick(smoothing: number): void {
    if (!this.handVisible) return;

    // interpola posição das esferas
    for (let i = 0; i < this.joints.length; i++) {
      const joint = this.joints[i];
      const target = this.targets[i];
      if (joint && target) {
        joint.visible = true;
        joint.position.lerp(target, smoothing);
      }
    }

    const wristMesh = this.joints[0];
    if (!wristMesh) return;

    // atualiza os 5 cilindros conectores entre o punho e as pontas dos dedos
    for (let b = 0; b < this.bones.length; b++) {
      const bone = this.bones[b];
      const tipMesh = this.joints[b + 1];
      if (!bone || !tipMesh) continue;

      const pA = wristMesh.position;
      const pB = tipMesh.position;
      const dist = pA.distanceTo(pB);

      if (dist > 0.005) {
        this.tmpMidpoint.addVectors(pA, pB).multiplyScalar(0.5);
        bone.position.copy(this.tmpMidpoint);
        bone.scale.set(1, dist, 1);
        this.tmpDirection.subVectors(pB, pA).normalize();
        bone.quaternion.setFromUnitVectors(Y_UNIT_VECTOR, this.tmpDirection);
        bone.visible = true;
      } else {
        bone.visible = false;
      }
    }
  }

  updateLandmarks(hand: HandLandmarks): void {
    this.handVisible = true;
    const system = getInteracxrSystem(this.ownerEl);

    MINIMALIST_HAND_LANDMARK_INDICES.forEach((landmarkIdx, i) => {
      const landmark = hand[landmarkIdx];
      if (landmark) {
        const { x, y, z } = system.calibration.mapLandmark(landmark, system.projectionPlane);
        this.targets[i]?.set(x, y, z);
      }
    });
  }

  hide(): void {
    this.handVisible = false;
    for (const joint of this.joints) {
      joint.visible = false;
    }
    for (const bone of this.bones) {
      bone.visible = false;
    }
    for (const target of this.targets) {
      target.set(0, 0, 0);
    }
  }

  dispose(): void {
    this.hide();
    for (const joint of this.joints) {
      joint.geometry.dispose();
      joint.removeFromParent();
    }
    for (const bone of this.bones) {
      bone.geometry.dispose();
      bone.removeFromParent();
    }
    this.joints.length = 0;
    this.bones.length = 0;
    this.targets.length = 0;
    this.group.removeFromParent();
  }
}

// controlador com suporte a rastreamento simultâneo de ambas as mãos (esquerda e direita)
export class HandModelController {
  private readonly leftHand: SingleHandVisual;
  private readonly rightHand: SingleHandVisual;
  private readonly sharedMaterial: MeshBasicMaterial;
  private readonly tmpViewport = new THREE.Vector4();
  private readonly tmpSize = new THREE.Vector2();

  private readonly onHandData = (event: Event): void => {
    this.handleHandData((event as CustomEvent<HandDataDetail>).detail);
  };

  constructor(
    private readonly el: Entity,
    private readonly data: HandModelData,
  ) {
    // modo de mesclagem por diferença para contraste dinâmico sobre fundos claros ou escuros (seção 3.3)
    this.sharedMaterial = new THREE.MeshBasicMaterial({
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

    const attachStereo = (mesh: Mesh, group: Group): void => {
      mesh.onBeforeRender = (renderer: WebGLRenderer): void => {
        const system = getInteracxrSystem(this.el);
        const eyeSign = detectStereoEyeSign(renderer, this.tmpViewport, this.tmpSize);
        group.position.x = eyeSign * system.calibration.stereoOffsetM;
        group.updateMatrix();
        if (group.parent) {
          group.matrixWorld.multiplyMatrices(group.parent.matrixWorld, group.matrix);
        }
        mesh.updateMatrix();
        mesh.matrixWorld.multiplyMatrices(group.matrixWorld, mesh.matrix);
      };
    };

    this.leftHand = new SingleHandVisual(
      this.el,
      data.jointRadius,
      this.sharedMaterial,
      attachStereo,
    );
    this.rightHand = new SingleHandVisual(
      this.el,
      data.jointRadius,
      this.sharedMaterial,
      attachStereo,
    );

    this.el.object3D.add(this.leftHand.group);
    this.el.object3D.add(this.rightHand.group);

    data.source?.addEventListener(HAND_DATA_EVENT, this.onHandData);
  }

  dispose(): void {
    this.data.source?.removeEventListener(HAND_DATA_EVENT, this.onHandData);
    this.leftHand.dispose();
    this.rightHand.dispose();
    this.sharedMaterial.dispose();
  }

  tick(): void {
    this.leftHand.tick(this.data.jointSmoothing);
    this.rightHand.tick(this.data.jointSmoothing);
  }

  private handleHandData(detail: HandDataDetail | undefined): void {
    if (!detail) {
      this.leftHand.hide();
      this.rightHand.hide();
      return;
    }

    const hands = detail.hands;
    if (hands && hands.length > 0) {
      let foundLeft = false;
      let foundRight = false;

      for (const hand of hands) {
        if (hand.handedness === 'left') {
          this.leftHand.updateLandmarks(hand.landmarks);
          foundLeft = true;
        } else if (hand.handedness === 'right') {
          this.rightHand.updateLandmarks(hand.landmarks);
          foundRight = true;
        }
      }

      // caso ambas tenham sido classificadas com a mesma lateralidade por ruído, separa por x
      if (hands.length === 2 && (!foundLeft || !foundRight)) {
        const handA = hands[0];
        const handB = hands[1];
        if (handA && handB) {
          const wristA = handA.landmarks[LANDMARK.WRIST]?.x ?? 0;
          const wristB = handB.landmarks[LANDMARK.WRIST]?.x ?? 1;
          if (wristA < wristB) {
            this.leftHand.updateLandmarks(handA.landmarks);
            this.rightHand.updateLandmarks(handB.landmarks);
          } else {
            this.leftHand.updateLandmarks(handB.landmarks);
            this.rightHand.updateLandmarks(handA.landmarks);
          }
          foundLeft = true;
          foundRight = true;
        }
      }

      if (!foundLeft) this.leftHand.hide();
      if (!foundRight) this.rightHand.hide();
    } else if (detail.landmarks) {
      // suporte a quadro único legado com inferência por posição horizontal (x < 0.55 é mão esquerda)
      const wrist = detail.landmarks[LANDMARK.WRIST];
      const isLeft = wrist ? wrist.x < 0.55 : false;
      if (isLeft) {
        this.leftHand.updateLandmarks(detail.landmarks);
        this.rightHand.hide();
      } else {
        this.rightHand.updateLandmarks(detail.landmarks);
        this.leftHand.hide();
      }
    } else {
      this.leftHand.hide();
      this.rightHand.hide();
    }
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
