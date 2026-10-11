import AFRAME, { type Component, type Entity } from 'aframe';
import type { Material, Mesh } from 'three';

import '../core/globals';
import type { CursorComponent } from './ixr-cursor';
import { THREE } from './three';

interface GazeGrabberData {
  targetClass: string;
  activationPose: string;
  grabPose: string;
  grabOpacity: number;
  grabSmoothing: number;
  pushPullMultiplier: number;
  showHUD: boolean;
}

export interface GazeGrabberComponent extends Component<GazeGrabberData> {
  controller?: GazeGrabberController;
}

interface SavedMaterial {
  opacity: number;
  transparent: boolean;
}

interface HandSizeDetail {
  handSize?: number;
}

const MIN_GRAB_DISTANCE = 0.4;

function singleMaterial(el: Entity): Material | null {
  const mesh = el.getObject3D('mesh') as Mesh | undefined;
  const material = mesh?.material;
  return material && !Array.isArray(material) ? material : null;
}

export class GazeGrabberController {
  private isAiming = false;
  private grabbedElement: Entity | null = null;
  private lockedDistance = 0;
  private baseLockedDistance = 0;
  private initialHandSize: number | null = null;
  private hud: Entity | null = null;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private readonly originalMaterials = new WeakMap<Entity, SavedMaterial>();
  private readonly listeners: [string, (event: Event) => void][];

  constructor(
    private readonly el: Entity,
    private readonly data: GazeGrabberData,
  ) {
    if (data.showHUD) this.createHUD();
    this.listeners = [
      [`ixr-${data.activationPose}-start`, () => this.onAimStart()],
      [`ixr-${data.activationPose}-end`, () => this.onAimEnd()],
      [`ixr-${data.grabPose}-start`, (event) => this.onGrabStart(event)],
      [`ixr-${data.grabPose}-move`, (event) => this.onGrabMove(event)],
      [`ixr-${data.grabPose}-end`, () => this.onGrabEnd()],
      ['ixr-hand-lost', () => this.onHandLost()],
    ];
    this.listeners.forEach(([name, listener]) => el.addEventListener(name, listener));
  }

  dispose(): void {
    this.listeners.forEach(([name, listener]) => this.el.removeEventListener(name, listener));
  }

  tick(): void {
    if (!this.grabbedElement) return;
    const camera = this.el.getObject3D('camera');
    if (!camera) return;
    camera.getWorldPosition(this.cameraPosition);
    camera.getWorldDirection(this.cameraDirection);
    this.targetPosition
      .copy(this.cameraPosition)
      .add(this.cameraDirection.clone().multiplyScalar(this.lockedDistance));
    const position = this.grabbedElement.object3D.position;
    position.lerp(this.targetPosition, this.data.grabSmoothing);
    this.grabbedElement.setAttribute('position', `${position.x} ${position.y} ${position.z}`);
  }

  private createHUD(): void {
    const hud = document.createElement('a-text') as Entity;
    hud.setAttribute('position', '0 -0.45 -1');
    hud.setAttribute('align', 'center');
    hud.setAttribute('width', '2');
    hud.setAttribute('value', 'Idle');
    hud.setAttribute('color', '#FFFFFF');
    this.el.appendChild(hud);
    this.hud = hud;
  }

  private setHUD(text: string): void {
    this.hud?.setAttribute('value', text);
  }

  private cursor(): CursorComponent | undefined {
    return this.el.components['ixr-cursor'] as CursorComponent | undefined;
  }

  private onAimStart(): void {
    if (!window.ixrInteractionManager.request('grab', this)) return;
    this.isAiming = true;
    this.setHUD('Aiming');
  }

  private onAimEnd(): void {
    if (this.grabbedElement) return;
    this.isAiming = false;
    window.ixrInteractionManager.release(this);
    this.setHUD('Idle');
  }

  private onGrabStart(event: Event): void {
    if (!this.isAiming) return;
    const cursor = this.cursor()?.controller;
    const hovered = cursor?.getHoveredElement();
    if (!cursor || !hovered || !hovered.matches(this.data.targetClass)) return;

    this.grabbedElement = hovered;
    // a bolinha é preenchida
    cursor.setCursorActive(true);

    const worldPosition = new THREE.Vector3();
    this.el.getObject3D('camera')?.getWorldPosition(this.cameraPosition);
    hovered.object3D.getWorldPosition(worldPosition);
    this.baseLockedDistance = worldPosition.distanceTo(this.cameraPosition);
    this.lockedDistance = this.baseLockedDistance;
    this.initialHandSize = (event as CustomEvent<HandSizeDetail>).detail.handSize ?? null;

    this.applyGrabMaterial(hovered);
    this.setHUD('Holding');
  }

  private onGrabMove(event: Event): void {
    const handSize = (event as CustomEvent<HandSizeDetail | undefined>).detail?.handSize;
    if (!this.grabbedElement || !this.initialHandSize || !handSize) return;
    const sizeDelta = this.initialHandSize - handSize;
    const pushPull = sizeDelta * this.data.pushPullMultiplier;
    this.lockedDistance = Math.max(MIN_GRAB_DISTANCE, this.baseLockedDistance + pushPull);
  }

  private onGrabEnd(): void {
    if (!this.grabbedElement) return;
    // o preenchimento da bolinha é removido
    this.cursor()?.controller?.setCursorActive(false);
    this.restoreMaterial(this.grabbedElement);
    this.grabbedElement = null;
    this.isAiming = false;
    window.ixrInteractionManager.release(this);
    this.setHUD('Idle');
  }

  private onHandLost(): void {
    this.onGrabEnd();
    this.onAimEnd();
  }

  private saveMaterial(el: Entity): void {
    const material = singleMaterial(el);
    if (this.originalMaterials.has(el) || !material) return;
    this.originalMaterials.set(el, {
      opacity: material.opacity,
      transparent: material.transparent,
    });
  }

  private restoreMaterial(el: Entity): void {
    const material = singleMaterial(el);
    const saved = this.originalMaterials.get(el);
    if (!material || !saved) return;
    material.opacity = saved.opacity;
    material.transparent = saved.transparent;
  }

  private applyGrabMaterial(el: Entity): void {
    const material = singleMaterial(el);
    if (!material) return;
    this.saveMaterial(el);
    material.opacity = this.data.grabOpacity;
    material.transparent = true;
  }
}

AFRAME.registerComponent<GazeGrabberComponent>('ixr-gaze-grabber', {
  schema: {
    targetClass: { type: 'string', default: '.grabbable' },
    activationPose: { type: 'string', default: 'victory' },
    grabPose: { type: 'string', default: 'grab' },
    grabOpacity: { type: 'number', default: 0.35 },
    grabSmoothing: { type: 'number', default: 0.2 },
    pushPullMultiplier: { type: 'number', default: 10.0 },
    showHUD: { type: 'boolean', default: false },
  },
  init() {
    this.controller = new GazeGrabberController(this.el, this.data);
  },
  tick() {
    this.controller?.tick();
  },
  remove() {
    this.controller?.dispose();
  },
});
