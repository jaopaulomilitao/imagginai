import AFRAME, { type Component, type Entity } from 'aframe';
import type { Box3, LineBasicMaterial, LineSegments, Mesh, Object3D } from 'three';

import { type HandDataDetail, type HandLandmarks, LANDMARK } from '../core/landmarks';
import { classifyFrame } from '../core/pose-classifier';
import type { CursorComponent, CursorHoverDetail } from './ixr-cursor';
import { HAND_DATA_EVENT } from './ixr-hand-tracking';
import { THREE } from './three';

export interface RotatableData {
  targetSelector: string;
  cameraSelector: string;
  rotationSpeed: number;
  easing: number;
  fadeOutDelayMs: number;
  boxColor: string;
  boxOpacity: number;
  boxPadding: number;
}

export interface RotatableComponent extends Component<RotatableData> {
  controller?: RotatableController;
}

function isIgnoredForRotation(el: Element | null, rootEl: Entity): boolean {
  let current: Element | null = el;
  while (current && current !== rootEl) {
    if (current.getAttribute('data-ixr-ignore-rotate') === 'true') {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isHitVolumeObject(obj: Object3D, rootObj: Object3D): boolean {
  let current: Object3D | null = obj;
  while (current && current !== rootObj) {
    const el = (current as Object3D & { el?: Entity }).el;
    if (
      el &&
      (el.getAttribute('data-hit-volume') === 'true' ||
        el.getAttribute('data-ixr-ignore-rotate') === 'true')
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

// componente reutilizável de rotação 3d exclusivamente pela mão esquerda enquanto o raio do cursor intersecta o objeto
export class RotatableController {
  private wireframeBox: LineSegments | null = null;
  private wireframeMaterial: LineBasicMaterial | null = null;
  private currentBoxOpacity = 0.0;
  private targetBoxOpacity = 0.0;
  private hoverElapsedMs = 0;
  private isHovered = false;
  private isRotating = false;
  private boundsDirty = true;

  private currentRotationX = 0;
  private currentRotationY = 0;
  private targetRotationX = 0;
  private targetRotationY = 0;
  private lastWristPos: { x: number; y: number } | null = null;

  private cameraEl: Entity | null = null;
  private handSourceEl: Entity | null = null;
  private readonly tmpBox: Box3 = new THREE.Box3();
  private readonly tmpChildBox: Box3 = new THREE.Box3();
  private readonly tmpSize = new THREE.Vector3();
  private readonly tmpCenter = new THREE.Vector3();
  private readonly tmpInvRootMatrix = new THREE.Matrix4();
  private readonly tmpChildMatrix = new THREE.Matrix4();

  private readonly onCursorHoverStart = (event: Event): void => {
    const hovered = (event as CustomEvent<CursorHoverDetail>).detail?.el ?? null;
    if (this.belongsToRotatable(hovered)) {
      this.enterHover();
    } else if (this.isHovered) {
      this.leaveHover();
    }
  };

  private readonly onCursorHoverEnd = (): void => {
    const hovered = this.currentHoveredElement();
    if (!this.belongsToRotatable(hovered)) {
      this.leaveHover();
    }
  };

  private readonly onHandData = (event: Event): void => {
    const detail = (event as CustomEvent<HandDataDetail>).detail;
    this.handleHandData(detail);
  };

  private readonly onChildChanged = (): void => {
    this.boundsDirty = true;
  };

  constructor(
    private readonly el: Entity,
    private data: RotatableData,
  ) {
    this.el.classList.add('rotatable');
    this.el.setAttribute('data-rotatable', 'true');

    const targetObj = this.getRotationTargetObject();
    this.currentRotationX = targetObj.rotation.x;
    this.currentRotationY = targetObj.rotation.y;
    this.targetRotationX = this.currentRotationX;
    this.targetRotationY = this.currentRotationY;

    this.createWireframeGizmo();
    this.bindEvents();
  }

  updateData(nextData: RotatableData): void {
    this.data = nextData;
    if (this.wireframeMaterial) {
      this.wireframeMaterial.color.set(this.data.boxColor);
    }
    this.boundsDirty = true;
  }

  getRotationState(): {
    isHovered: boolean;
    isRotating: boolean;
    currentRotationX: number;
    currentRotationY: number;
    targetRotationX: number;
    targetRotationY: number;
    boxOpacity: number;
  } {
    return {
      isHovered: this.isHovered,
      isRotating: this.isRotating,
      currentRotationX: this.currentRotationX,
      currentRotationY: this.currentRotationY,
      targetRotationX: this.targetRotationX,
      targetRotationY: this.targetRotationY,
      boxOpacity: this.currentBoxOpacity,
    };
  }

  // recalcula a caixa delimitadora em wireframe (apenas arestas) para envolver perfeitamente o objeto 3d
  recalculateBounds(): void {
    const targetObj = this.getRotationTargetObject();
    if (!this.wireframeBox) {
      this.createWireframeGizmo();
    }
    if (!this.wireframeBox) return;

    if (this.wireframeBox.parent !== targetObj) {
      targetObj.add(this.wireframeBox);
    }

    targetObj.updateMatrixWorld(true);
    this.tmpInvRootMatrix.copy(targetObj.matrixWorld).invert();
    this.tmpBox.makeEmpty();

    let foundVisualGeometry = false;
    targetObj.traverse((child: Object3D) => {
      if (child === targetObj || child === this.wireframeBox) return;
      if (child.userData?.isRotatableGizmo) return;
      if (isHitVolumeObject(child, targetObj)) return;

      const mesh = child as Mesh;
      const geom = mesh.geometry;
      if (!geom) return;

      // ignora textos troika no cálculo de caixa para que o cubo envolva exatamente a estrutura geométrica
      const ownerEl = (child as Object3D & { el?: Entity }).el;
      if (ownerEl?.tagName?.toLowerCase() === 'a-troika-text') return;

      if (!geom.boundingBox) {
        geom.computeBoundingBox();
      }
      if (!geom.boundingBox || geom.boundingBox.isEmpty()) return;

      this.tmpChildBox.copy(geom.boundingBox);
      this.tmpChildMatrix.multiplyMatrices(this.tmpInvRootMatrix, child.matrixWorld);
      this.tmpChildBox.applyMatrix4(this.tmpChildMatrix);
      this.tmpBox.union(this.tmpChildBox);
      foundVisualGeometry = true;
    });

    const pad = Math.max(0, this.data.boxPadding);
    let width = 0.84;
    let height = 0.56;
    let depth = 0.36;
    this.tmpCenter.set(0, 0, 0);

    if (foundVisualGeometry && !this.tmpBox.isEmpty()) {
      this.tmpBox.getSize(this.tmpSize);
      this.tmpBox.getCenter(this.tmpCenter);
      width = Math.max(0.08, this.tmpSize.x + pad * 2);
      height = Math.max(0.08, this.tmpSize.y + pad * 2);
      depth = Math.max(0.08, this.tmpSize.z + pad * 2);
    }

    const nextBoxGeom = new THREE.BoxGeometry(width, height, depth);
    const nextEdgesGeom = new THREE.EdgesGeometry(nextBoxGeom);
    nextBoxGeom.dispose();

    this.wireframeBox.geometry.dispose();
    this.wireframeBox.geometry = nextEdgesGeom;
    this.wireframeBox.position.copy(this.tmpCenter);
    this.boundsDirty = false;
  }

  tick(timeDeltaMs: number): void {
    const dtMs = Number.isFinite(timeDeltaMs) && timeDeltaMs > 0 ? Math.min(timeDeltaMs, 100) : 16.6;
    const dtSec = dtMs / 1000;

    if (this.boundsDirty) {
      this.recalculateBounds();
    }

    // valida a cada quadro se o raycast do cursor ainda intersecta ativamente o objeto rotacionável
    this.syncActiveRaycastHover();

    // controla o fade-out automático da caixa wireframe após 2000ms de foco
    if (this.isHovered) {
      this.hoverElapsedMs += dtMs;
      if (this.hoverElapsedMs >= this.data.fadeOutDelayMs) {
        this.targetBoxOpacity = 0.0;
      }
    } else {
      this.targetBoxOpacity = 0.0;
    }

    if (this.wireframeMaterial && this.wireframeBox) {
      const opacityAlpha = 1 - Math.exp(-10 * dtSec);
      const diff = this.targetBoxOpacity - this.currentBoxOpacity;
      if (Math.abs(diff) > 0.002) {
        this.currentBoxOpacity += diff * opacityAlpha;
      } else {
        this.currentBoxOpacity = this.targetBoxOpacity;
      }
      this.wireframeMaterial.opacity = this.currentBoxOpacity;
      this.wireframeBox.visible = this.currentBoxOpacity > 0.005;
    }

    // interpolação suave (easing) dos eixos de rotação x (vertical) e y (horizontal)
    const targetObj = this.getRotationTargetObject();
    const easingFactor = 1 - Math.exp(-Math.max(0.02, this.data.easing) * 60 * dtSec);
    const diffX = this.targetRotationX - this.currentRotationX;
    const diffY = this.targetRotationY - this.currentRotationY;

    if (Math.abs(diffX) > 0.0001 || Math.abs(diffY) > 0.0001) {
      this.currentRotationX += diffX * easingFactor;
      this.currentRotationY += diffY * easingFactor;
      targetObj.rotation.x = this.currentRotationX;
      targetObj.rotation.y = this.currentRotationY;
    }
  }

  dispose(): void {
    this.el.removeEventListener('child-attached', this.onChildChanged);
    this.el.removeEventListener('object3dset', this.onChildChanged);
    if (this.cameraEl) {
      this.cameraEl.removeEventListener('ixr-cursor-hover-start', this.onCursorHoverStart);
      this.cameraEl.removeEventListener('ixr-cursor-hover-end', this.onCursorHoverEnd);
      this.cameraEl = null;
    }
    if (this.handSourceEl) {
      this.handSourceEl.removeEventListener(HAND_DATA_EVENT, this.onHandData);
      this.handSourceEl = null;
    }
    if (this.wireframeBox) {
      this.wireframeBox.geometry.dispose();
      this.wireframeMaterial?.dispose();
      this.wireframeBox.removeFromParent();
      this.wireframeBox = null;
      this.wireframeMaterial = null;
    }
  }

  private getRotationTargetEntity(): Entity {
    if (this.data.targetSelector) {
      const match = this.el.querySelector<Entity>(this.data.targetSelector);
      if (match) return match;
    }
    const defaultChild = this.el.querySelector<Entity>('[data-rotatable-volume]');
    return defaultChild ?? this.el;
  }

  private getRotationTargetObject(): Object3D {
    return this.getRotationTargetEntity().object3D;
  }

  private createWireframeGizmo(): void {
    const boxGeom = new THREE.BoxGeometry(0.84, 0.56, 0.36);
    const edgesGeom = new THREE.EdgesGeometry(boxGeom);
    boxGeom.dispose();

    this.wireframeMaterial = new THREE.LineBasicMaterial({
      color: this.data.boxColor,
      transparent: true,
      opacity: 0.0,
      depthTest: false,
      depthWrite: false,
    });
    this.wireframeBox = new THREE.LineSegments(edgesGeom, this.wireframeMaterial);
    this.wireframeBox.userData.isRotatableGizmo = true;
    this.wireframeBox.renderOrder = 95;
    this.wireframeBox.visible = false;
    this.getRotationTargetObject().add(this.wireframeBox);
  }

  private bindEvents(): void {
    this.el.addEventListener('child-attached', this.onChildChanged);
    this.el.addEventListener('object3dset', this.onChildChanged);

    const scene = this.el.sceneEl;
    if (!scene) return;

    const attachSceneSources = (): void => {
      const cam =
        scene.querySelector<Entity>(this.data.cameraSelector) ??
        scene.querySelector<Entity>('[ixr-cursor]');
      if (cam) {
        this.cameraEl = cam;
        cam.addEventListener('ixr-cursor-hover-start', this.onCursorHoverStart);
        cam.addEventListener('ixr-cursor-hover-end', this.onCursorHoverEnd);
      }

      const tracker =
        scene.querySelector<Entity>('[ixr-hand-tracking]') ??
        scene.querySelector<Entity>(this.data.cameraSelector);
      if (tracker) {
        this.handSourceEl = tracker;
        tracker.addEventListener(HAND_DATA_EVENT, this.onHandData);
      }
    };

    if (scene.hasLoaded) {
      attachSceneSources();
    } else {
      scene.addEventListener('loaded', attachSceneSources, { once: true });
    }
  }

  private syncActiveRaycastHover(): void {
    const cursor = this.cameraEl?.components['ixr-cursor'] as CursorComponent | undefined;
    if (!cursor?.controller) return;
    const hovered = cursor.controller.getHoveredElement();
    const activelyIntersecting = this.belongsToRotatable(hovered);
    if (activelyIntersecting && !this.isHovered) {
      this.enterHover();
    } else if (!activelyIntersecting && this.isHovered) {
      this.leaveHover();
    }
  }

  private enterHover(): void {
    if (this.boundsDirty) {
      this.recalculateBounds();
    }
    if (!this.isHovered) {
      this.isHovered = true;
      this.hoverElapsedMs = 0;
      this.targetBoxOpacity = this.data.boxOpacity;
    }
  }

  private leaveHover(): void {
    this.isHovered = false;
    this.isRotating = false;
    this.lastWristPos = null;
    this.hoverElapsedMs = 0;
    this.targetBoxOpacity = 0.0;
  }

  private currentHoveredElement(): Entity | null {
    const cursor = this.cameraEl?.components['ixr-cursor'] as CursorComponent | undefined;
    return cursor?.controller?.getHoveredElement() ?? null;
  }

  private belongsToRotatable(target: Entity | null): boolean {
    if (!target) return false;
    if (target !== this.el && !this.el.contains(target)) return false;
    return !isIgnoredForRotation(target, this.el);
  }

  // separação estrita: seleciona exclusivamente a mão esquerda para rotação apenas quando duas mãos estão presentes na cena
  private selectLeftHandStrict(detail: HandDataDetail): HandLandmarks | null {
    const hands = detail.hands ?? [];
    if (hands.length < 2) return null;
    const leftTracked = hands.find((h) => h.handedness === 'left');
    return leftTracked?.landmarks ?? null;
  }

  private handleHandData(detail: HandDataDetail | undefined): void {
    this.syncActiveRaycastHover();

    // modo de rotação ativo apenas enquanto o raycast do cursor intersecta o objeto rotacionável
    if (!detail || !this.isHovered) {
      this.isRotating = false;
      this.lastWristPos = null;
      return;
    }

    const leftHand = this.selectLeftHandStrict(detail);
    if (!leftHand || leftHand.length === 0) {
      this.isRotating = false;
      this.lastWristPos = null;
      return;
    }

    const wrist = leftHand[LANDMARK.WRIST];
    if (!wrist) return;

    const pose = classifyFrame(leftHand, this.isRotating);
    const isClosedHandGrab = pose.grab;

    if (isClosedHandGrab) {
      this.isRotating = true;
      if (this.lastWristPos) {
        const deltaX = wrist.x - this.lastWristPos.x;
        const deltaY = wrist.y - this.lastWristPos.y;
        // movimento horizontal (x) mapeado para rotação no eixo y; movimento vertical (y) mapeado para rotação no eixo x
        this.targetRotationY += deltaX * Math.PI * this.data.rotationSpeed;
        this.targetRotationX += deltaY * Math.PI * this.data.rotationSpeed;
      }
      this.lastWristPos = { x: wrist.x, y: wrist.y };
    } else {
      this.isRotating = false;
      this.lastWristPos = null;
    }
  }
}

AFRAME.registerComponent<RotatableComponent>('ixr-rotatable', {
  schema: {
    targetSelector: { type: 'string', default: '' },
    cameraSelector: { type: 'string', default: '#main-camera' },
    rotationSpeed: { type: 'number', default: 3.2 },
    easing: { type: 'number', default: 0.16 },
    fadeOutDelayMs: { type: 'number', default: 2000 },
    boxColor: { type: 'color', default: '#FFFFFF' },
    boxOpacity: { type: 'number', default: 0.65 },
    boxPadding: { type: 'number', default: 0.024 },
  },
  init() {
    this.controller = new RotatableController(this.el, this.data);
  },
  update() {
    this.controller?.updateData(this.data);
  },
  tick(_time, timeDelta) {
    this.controller?.tick(timeDelta);
  },
  remove() {
    this.controller?.dispose();
  },
});

if (typeof AFRAME.registerPrimitive === 'function') {
  AFRAME.registerPrimitive('a-ixr-rotatable', {
    defaultComponents: {
      'ixr-rotatable': {},
    },
    mappings: {
      'target-selector': 'ixr-rotatable.targetSelector',
      'camera-selector': 'ixr-rotatable.cameraSelector',
      'rotation-speed': 'ixr-rotatable.rotationSpeed',
      easing: 'ixr-rotatable.easing',
      'fade-out-delay-ms': 'ixr-rotatable.fadeOutDelayMs',
      'box-color': 'ixr-rotatable.boxColor',
      'box-opacity': 'ixr-rotatable.boxOpacity',
      'box-padding': 'ixr-rotatable.boxPadding',
    },
  });
}
