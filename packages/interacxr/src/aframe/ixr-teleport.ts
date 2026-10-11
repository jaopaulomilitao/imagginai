import AFRAME, { type Component, type Entity } from 'aframe';
import type { BufferGeometry, Line, LineBasicMaterial, Object3D, Vector3 } from 'three';

import '../core/globals';
import type { CursorComponent } from './ixr-cursor';
import { THREE } from './three';

interface TeleportData {
  rig: Entity | null;
  targetClass: string;
  activationPose: string;
  confirmPose: string;
  cancelPose: string;
  power: number;
  floorY: number;
  showArc: boolean;
}

export interface TeleportComponent extends Component<TeleportData> {
  controller?: TeleportController;
}

const GRAVITY = -9.8;
const ARC_TIME_STEP_S = 0.05;
const ARC_MAX_STEPS = 40;
const ARC_ORIGIN_DROP_M = 0.2;
const ARC_UPWARD_BIAS = 0.2;
const CONFIRM_FEEDBACK_MS = 150;

export class TeleportController {
  private isAiming = false;
  private isValidHit = false;
  private readonly hitPoint = new THREE.Vector3();
  // motor de colisão da curva
  private readonly raycaster = new THREE.Raycaster();
  private readonly arcLine: Line<BufferGeometry, LineBasicMaterial>;
  private readonly reticle: Entity;
  private readonly listeners: [string, () => void][];

  constructor(
    private readonly el: Entity,
    private readonly data: TeleportData,
  ) {
    this.arcLine = this.createArc();
    this.reticle = this.createReticle();
    this.listeners = [
      [`ixr-${data.activationPose}-start`, () => this.onActivate()],
      [`ixr-${data.confirmPose}-start`, () => this.onConfirm()],
      ['ixr-hand-lost', () => undefined],
    ];
    this.listeners.forEach(([name, listener]) => el.addEventListener(name, listener));
  }

  dispose(): void {
    this.listeners.forEach(([name, listener]) => this.el.removeEventListener(name, listener));
    this.el.sceneEl.object3D.remove(this.arcLine);
    this.reticle.remove();
  }

  tick(): void {
    if (!this.isAiming) return;
    const camera = this.el.getObject3D('camera');
    if (!camera) return;
    const points = this.traceArc(camera);
    if (this.data.showArc) this.arcLine.geometry.setFromPoints(points);
    this.reticle.setAttribute('visible', this.isValidHit);
    if (this.isValidHit) {
      const { x, y, z } = this.hitPoint;
      this.reticle.setAttribute('position', `${x} ${y + 0.01} ${z}`);
    }
  }

  private createArc(): Line<BufferGeometry, LineBasicMaterial> {
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      // o original pedia DifferenceBlending, inexistente no three; vale o blending normal
      blending: THREE.NormalBlending,
    });
    const arcLine = new THREE.Line(new THREE.BufferGeometry(), material);
    arcLine.visible = false;
    this.el.sceneEl.object3D.add(arcLine);
    return arcLine;
  }

  private createReticle(): Entity {
    const reticle = document.createElement('a-ring') as Entity;
    reticle.setAttribute('radius-inner', '0.18');
    reticle.setAttribute('radius-outer', '0.28');
    reticle.setAttribute('rotation', '-90 0 0');
    reticle.setAttribute('material', 'shader:flat;color:#ffffff;transparent:true;opacity:0.85');
    reticle.setAttribute('visible', false);
    this.el.sceneEl.appendChild(reticle);
    return reticle;
  }

  private onActivate(): void {
    if (this.isAiming) {
      this.cancel();
      return;
    }
    if (!window.ixrInteractionManager.request('teleport', this)) return;
    this.isAiming = true;
    this.arcLine.visible = this.data.showArc;
  }

  private onConfirm(): void {
    const rig = this.data.rig;
    if (!this.isAiming || !this.isValidHit || !rig) return;
    // feedback visual preenchendo o cursor instantaneamente
    const cursor = (this.el.components['ixr-cursor'] as CursorComponent | undefined)?.controller;
    if (cursor) {
      cursor.setCursorActive(true);
      setTimeout(() => cursor.setCursorActive(false), CONFIRM_FEEDBACK_MS);
    }
    // o eixo y adota a altura exata do obstáculo atingido
    rig.setAttribute('position', { x: this.hitPoint.x, y: this.hitPoint.y, z: this.hitPoint.z });
    this.cancel();
  }

  private cancel(): void {
    this.isAiming = false;
    this.isValidHit = false;
    this.arcLine.visible = false;
    this.reticle.setAttribute('visible', false);
    window.ixrInteractionManager.release(this);
  }

  private traceArc(camera: Object3D): Vector3[] {
    const start = camera.getWorldPosition(new THREE.Vector3());
    start.y -= ARC_ORIGIN_DROP_M;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
      camera.getWorldQuaternion(new THREE.Quaternion()),
    );
    direction.y += ARC_UPWARD_BIAS;
    const velocity = direction.normalize().multiplyScalar(this.data.power);
    return this.integrateArc(start, velocity);
  }

  private integrateArc(start: Vector3, velocity: Vector3): Vector3[] {
    const gravityStep = new THREE.Vector3(0, GRAVITY * ARC_TIME_STEP_S, 0);
    // são mapeados os objetos físicos do cenário que bloqueiam o teleporte
    const obstacles = Array.from(this.el.sceneEl.querySelectorAll<Entity>(this.data.targetClass))
      .map((entity) => entity.object3D)
      .filter(Boolean);
    let current = start.clone();
    const points = [current.clone()];
    this.isValidHit = false;

    for (let i = 0; i < ARC_MAX_STEPS; i++) {
      const next = current.clone().add(velocity.clone().multiplyScalar(ARC_TIME_STEP_S));
      velocity.add(gravityStep);
      if (this.hitsObstacle(current, next, obstacles) || this.hitsFloor(current, next)) {
        points.push(this.hitPoint.clone());
        break;
      }
      current = next;
      points.push(current.clone());
    }
    return points;
  }

  private hitsObstacle(current: Vector3, next: Vector3, obstacles: Object3D[]): boolean {
    // é lançado um raio para verificar colisão no segmento atual da parábola
    const step = next.clone().sub(current);
    const stepLength = step.length();
    this.raycaster.set(current, step.normalize());
    const hit = this.raycaster.intersectObjects(obstacles, true)[0];
    if (!hit || hit.distance > stepLength) return false;
    this.hitPoint.copy(hit.point);
    this.isValidHit = true;
    return true;
  }

  private hitsFloor(current: Vector3, next: Vector3): boolean {
    // sem obstáculo, a curva para no chão infinito (floorY)
    if (next.y > this.data.floorY) return false;
    const ratio = (current.y - this.data.floorY) / (current.y - next.y);
    this.hitPoint.lerpVectors(current, next, ratio);
    this.isValidHit = true;
    return true;
  }
}

AFRAME.registerComponent<TeleportComponent>('ixr-teleport', {
  schema: {
    rig: { type: 'selector', default: '#camera-rig' },
    // define quais objetos bloqueiam o arco e servem de chão
    targetClass: { type: 'string', default: '.navmesh' },
    activationPose: { type: 'string', default: 'rock' },
    confirmPose: { type: 'string', default: 'pinch' },
    cancelPose: { type: 'string', default: 'rock' },
    power: { type: 'number', default: 6 },
    floorY: { type: 'number', default: 0 },
    showArc: { type: 'boolean', default: true },
  },
  init() {
    this.controller = new TeleportController(this.el, this.data);
  },
  tick() {
    this.controller?.tick();
  },
  remove() {
    this.controller?.dispose();
  },
});
