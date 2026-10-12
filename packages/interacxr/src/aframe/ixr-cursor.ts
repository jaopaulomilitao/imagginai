import AFRAME, { type Component, type Entity } from 'aframe';
import type {
  CircleGeometry,
  Intersection,
  Mesh,
  MeshBasicMaterial,
  MeshBasicMaterialParameters,
  Object3D,
  RingGeometry,
} from 'three';

import type { TargetCache } from '../core/target-cache';
import { createObject3DCache, findOwnerEntity } from './entity-utils';
import { THREE } from './three';

interface CursorData {
  targetClass: string;
  maxDistance: number;
  cursorSize: number;
  cursorColor: string;
  idleOpacity: number;
  hoverOpacity: number;
  useNegativeEffect: boolean;
}

export interface CursorComponent extends Component<CursorData> {
  controller?: CursorController;
}

type CursorGeometry = RingGeometry | CircleGeometry;

export interface CursorHoverDetail {
  el: Entity;
}

export class CursorController {
  private readonly raycaster = new THREE.Raycaster();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly ringGeometry: RingGeometry;
  private readonly solidGeometry: CircleGeometry;
  private readonly cursorMesh: Mesh<CursorGeometry, MeshBasicMaterial>;
  private hoveredElement: Entity | null = null;
  private intersectionData: Intersection | null = null;
  private isActive = false;
  private readonly targets: TargetCache<Object3D>;

  constructor(
    private readonly el: Entity,
    private readonly data: CursorData,
  ) {
    this.ringGeometry = new THREE.RingGeometry(data.cursorSize, data.cursorSize * 1.5, 32);
    this.solidGeometry = new THREE.CircleGeometry(data.cursorSize * 1.5, 32);
    this.cursorMesh = this.createCursor();
    this.targets = createObject3DCache(el.sceneEl, data.targetClass);
  }

  dispose(): void {
    this.targets.dispose();
    this.cursorMesh.removeFromParent();
    this.cursorMesh.material.dispose();
    this.ringGeometry.dispose();
    this.solidGeometry.dispose();
  }

  setCursorActive(active: boolean): void {
    this.isActive = active;
    if (active) {
      this.cursorMesh.geometry = this.solidGeometry;
      this.cursorMesh.material.opacity = this.data.hoverOpacity;
      return;
    }
    this.cursorMesh.geometry = this.ringGeometry;
    this.cursorMesh.material.opacity = this.hoveredElement
      ? this.data.hoverOpacity
      : this.data.idleOpacity;
  }

  getHoveredElement(): Entity | null {
    return this.hoveredElement;
  }

  getIntersection(): Intersection | null {
    return this.intersectionData;
  }

  tick(): void {
    const camera = this.el.getObject3D('camera');
    if (!camera) return;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldDirection(this.cameraDirection);
    this.raycaster.set(this.cameraPosition, this.cameraDirection);

    const hit = this.raycaster.intersectObjects(this.targets.get(), true)[0];

    if (hit && hit.distance <= this.data.maxDistance) {
      this.onHit(hit);
    } else {
      this.onMiss();
    }
  }

  private createCursor(): Mesh<CursorGeometry, MeshBasicMaterial> {
    // é construída a configuração base do material
    const config: MeshBasicMaterialParameters = {
      color: this.data.cursorColor,
      transparent: true,
      opacity: this.data.idleOpacity,
      depthTest: false,
      side: THREE.DoubleSide,
    };
    // é aplicado o efeito negativo caso a propriedade esteja habilitada
    if (this.data.useNegativeEffect) {
      config.blending = THREE.CustomBlending;
      config.blendEquation = THREE.AddEquation;
      config.blendSrc = THREE.OneMinusDstColorFactor;
      config.blendDst = THREE.OneMinusSrcColorFactor;
    }
    const mesh = new THREE.Mesh<CursorGeometry, MeshBasicMaterial>(
      this.ringGeometry,
      new THREE.MeshBasicMaterial(config),
    );
    mesh.position.set(0, 0, -1);
    mesh.renderOrder = 1000;
    this.el.object3D.add(mesh);
    return mesh;
  }

  private onHit(hit: Intersection): void {
    // é realizada a busca pelo elemento pai que possui o componente a-frame ou corresponde ao seletor
    const owner = findOwnerEntity(hit.object, this.data.targetClass);
    if (owner && this.hoveredElement !== owner) {
      if (this.hoveredElement) this.emitHover('ixr-cursor-hover-end', this.hoveredElement);
      this.hoveredElement = owner;
      this.emitHover('ixr-cursor-hover-start', owner);
      if (!this.isActive) this.cursorMesh.material.opacity = this.data.hoverOpacity;
    }
    this.intersectionData = hit;
  }

  private onMiss(): void {
    if (!this.hoveredElement) return;
    this.emitHover('ixr-cursor-hover-end', this.hoveredElement);
    this.hoveredElement = null;
    this.intersectionData = null;
    if (!this.isActive) this.cursorMesh.material.opacity = this.data.idleOpacity;
  }

  private emitHover(name: string, el: Entity): void {
    const detail: CursorHoverDetail = { el };
    this.el.emit(name, detail);
  }
}

AFRAME.registerComponent<CursorComponent>('ixr-cursor', {
  schema: {
    targetClass: { type: 'string', default: '.grabbable, .interactable' },
    maxDistance: { type: 'number', default: 10 },
    cursorSize: { type: 'number', default: 0.01 },
    cursorColor: { type: 'color', default: '#FFFFFF' },
    idleOpacity: { type: 'number', default: 0.3 },
    hoverOpacity: { type: 'number', default: 1.0 },
    // é definida a propriedade para alternar o efeito negativo
    useNegativeEffect: { type: 'boolean', default: false },
  },
  init() {
    this.controller = new CursorController(this.el, this.data);
  },
  tick() {
    this.controller?.tick();
  },
  remove() {
    this.controller?.dispose();
  },
});
