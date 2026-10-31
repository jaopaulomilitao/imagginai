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
  hoverScale: number;
  activeScale: number;
  useNegativeEffect: boolean;
}

export interface CursorComponent extends Component<CursorData> {
  controller?: CursorController;
}

type CursorGeometry = RingGeometry | CircleGeometry;

export interface CursorHoverDetail {
  el: Entity;
}

// primeira entidade a-frame dona do object3d atingido (sem resolver seletor)
function firstEntityOf(object: Object3D): Entity | null {
  let current: Object3D | null = object;
  while (current) {
    const owner: unknown = Reflect.get(current, 'el');
    if (owner instanceof HTMLElement) return owner as Entity;
    current = current.parent;
  }
  return null;
}

// descarta objetos que nunca devem receber o cursor: invisíveis, linhas, pontos, gizmos e textos decorativos
function isPickable(object: Object3D): boolean {
  const flags = object as Object3D & { isLine?: boolean; isPoints?: boolean };
  if (flags.isLine || flags.isPoints) return false;
  if (object.userData?.isRotatableGizmo) return false;
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  const entity = firstEntityOf(object);
  if (entity?.hasAttribute('troika-text') && !entity.classList.contains('interactable')) {
    return false;
  }
  return true;
}

function isSoftHit(item: Intersection): boolean {
  return firstEntityOf(item.object)?.getAttribute('data-hit-volume') === 'true';
}

// volumes data-hit-volume são alvos de baixa prioridade: qualquer elemento concreto (botões,
// nós, alças ou outros painéis) vence um volume de foco invisível
function selectHit(hits: Intersection[]): Intersection | undefined {
  return hits.find((item) => !isSoftHit(item)) ?? hits[0];
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
  private currentScale = 1.0;
  private targetScale = 1.0;
  private readonly targets: TargetCache<Object3D>;

  private readonly onGestureOrPointerStart = (): void => {
    this.setCursorActive(true);
  };

  private readonly onGestureOrPointerEnd = (): void => {
    this.setCursorActive(false);
  };

  private readonly onPointerDown = (): void => {
    this.onGestureOrPointerStart();
    this.el.emit('ixr-pinch-start', {});
  };

  private readonly onPointerUp = (): void => {
    this.onGestureOrPointerEnd();
    this.el.emit('ixr-pinch-end', {});
  };

  constructor(
    private readonly el: Entity,
    private readonly data: CursorData,
  ) {
    // o limiar padrão do three.js para linhas é 1 metro, o que faz arestas e contornos capturarem o raio
    this.raycaster.params.Line = { threshold: 0.002 };
    this.raycaster.params.Points = { threshold: 0.002 };
    this.ringGeometry = new THREE.RingGeometry(data.cursorSize, data.cursorSize * 1.5, 32);
    this.solidGeometry = new THREE.CircleGeometry(data.cursorSize * 1.5, 32);
    this.cursorMesh = this.createCursor();
    this.targets = createObject3DCache(el.sceneEl, data.targetClass);

    el.addEventListener('ixr-pinch-start', this.onGestureOrPointerStart);
    el.addEventListener('ixr-pinch-end', this.onGestureOrPointerEnd);
    el.addEventListener('ixr-grab-start', this.onGestureOrPointerStart);
    el.addEventListener('ixr-grab-end', this.onGestureOrPointerEnd);
    el.addEventListener('ixr-hand-lost', this.onGestureOrPointerEnd);
    if (typeof window !== 'undefined') {
      window.addEventListener('mousedown', this.onPointerDown);
      window.addEventListener('mouseup', this.onPointerUp);
    }
  }

  dispose(): void {
    this.el.removeEventListener('ixr-pinch-start', this.onGestureOrPointerStart);
    this.el.removeEventListener('ixr-pinch-end', this.onGestureOrPointerEnd);
    this.el.removeEventListener('ixr-grab-start', this.onGestureOrPointerStart);
    this.el.removeEventListener('ixr-grab-end', this.onGestureOrPointerEnd);
    this.el.removeEventListener('ixr-hand-lost', this.onGestureOrPointerEnd);
    if (typeof window !== 'undefined') {
      window.removeEventListener('mousedown', this.onPointerDown);
      window.removeEventListener('mouseup', this.onPointerUp);
    }
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
      this.targetScale = this.data.activeScale;
      return;
    }
    this.cursorMesh.geometry = this.ringGeometry;
    this.cursorMesh.material.opacity = this.hoveredElement
      ? this.data.hoverOpacity
      : this.data.idleOpacity;
    this.targetScale = this.hoveredElement ? this.data.hoverScale : 1.0;
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

    const rawHits = this.raycaster.intersectObjects(this.targets.get(), true);
    const validHits = rawHits.filter(
      (item) => item.distance <= this.data.maxDistance && isPickable(item.object),
    );
    const hit = selectHit(validHits);

    if (hit) {
      this.onHit(hit);
    } else {
      this.onMiss();
    }

    // interpola suavemente a escala do cursor (maior em hover, menor em clique/grab)
    this.currentScale += (this.targetScale - this.currentScale) * 0.35;
    this.cursorMesh.scale.setScalar(this.currentScale);
  }

  private createCursor(): Mesh<CursorGeometry, MeshBasicMaterial> {
    // é construída a configuração base do material com blend mode difference ativo por padrão
    const config: MeshBasicMaterialParameters = {
      color: this.data.cursorColor,
      transparent: true,
      opacity: this.data.idleOpacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
    };
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
    if (!owner) {
      this.onMiss();
      return;
    }
    this.intersectionData = hit;
    if (this.hoveredElement !== owner) {
      const previous = this.hoveredElement;
      this.hoveredElement = owner;
      if (previous) this.emitHover('ixr-cursor-hover-end', previous);
      this.emitHover('ixr-cursor-hover-start', owner);
      if (!this.isActive) {
        this.cursorMesh.material.opacity = this.data.hoverOpacity;
        this.targetScale = this.data.hoverScale;
      }
    }
  }

  private onMiss(): void {
    if (!this.hoveredElement) return;
    const previous = this.hoveredElement;
    this.hoveredElement = null;
    this.intersectionData = null;
    this.emitHover('ixr-cursor-hover-end', previous);
    if (!this.isActive) {
      this.cursorMesh.material.opacity = this.data.idleOpacity;
      this.targetScale = 1.0;
    }
  }

  private emitHover(name: string, el: Entity): void {
    const detail: CursorHoverDetail = { el };
    this.el.emit(name, detail);
  }
}

AFRAME.registerComponent<CursorComponent>('ixr-cursor', {
  schema: {
    targetClass: { type: 'string', default: '.grabbable, .interactable, .rotatable' },
    maxDistance: { type: 'number', default: 10 },
    cursorSize: { type: 'number', default: 0.01 },
    cursorColor: { type: 'color', default: '#FFFFFF' },
    idleOpacity: { type: 'number', default: 1.0 },
    hoverOpacity: { type: 'number', default: 1.0 },
    hoverScale: { type: 'number', default: 1.42 },
    activeScale: { type: 'number', default: 0.65 },
    // blend mode difference ativado por padrão para visibilidade sobre fundos claros e escuros
    useNegativeEffect: { type: 'boolean', default: true },
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
