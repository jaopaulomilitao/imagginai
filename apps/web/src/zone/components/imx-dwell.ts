import AFRAME, { type Component, type Entity } from 'aframe';
import type { CursorHoverDetail } from 'interacxr';
import type { Mesh, MeshBasicMaterial, RingGeometry } from 'three';

import { DWELL_DURATION_MS } from '../config/constants';
import { DwellTimer } from '../systems/dwell-controller';

export const DWELL_TRIGGER_EVENT = 'imx-dwell';

interface DwellData {
  durationMs: number;
  ringInnerRadius: number;
  ringOuterRadius: number;
  ringColor: string;
}

export interface DwellComponent extends Component<DwellData> {
  controller?: DwellComponentController;
}

function isDwellTarget(el: Entity | null): boolean {
  if (!el) return false;
  return el.classList.contains('interactable') && !el.hasAttribute('data-no-dwell');
}

// controlador de dwell genérico (800 ms) com anel de progresso no cursor de olhar (seção 3.2)
export class DwellComponentController {
  readonly timer: DwellTimer<Entity>;
  private ringMesh: Mesh<RingGeometry, MeshBasicMaterial> | null = null;
  private lastProgress = -1;

  private readonly onHoverStart = (event: Event): void => {
    const target = (event as CustomEvent<CursorHoverDetail>).detail.el;
    this.timer.setTarget(isDwellTarget(target) ? target : null);
    this.updateRing(0);
  };

  private readonly onHoverEnd = (): void => {
    this.timer.setTarget(null);
    this.updateRing(0);
  };

  constructor(
    private readonly el: Entity,
    private data: DwellData,
  ) {
    this.timer = new DwellTimer<Entity>(data.durationMs);
    this.createRingMesh();
    this.el.addEventListener('ixr-cursor-hover-start', this.onHoverStart);
    this.el.addEventListener('ixr-cursor-hover-end', this.onHoverEnd);
  }

  tick(deltaMs: number): void {
    const result = this.timer.step(deltaMs);
    this.updateRing(result.progress);
    if (result.triggered && result.target) {
      result.target.emit(DWELL_TRIGGER_EVENT, { source: this.el });
      result.target.emit('click', { source: 'dwell' });
    }
  }

  restartCurrentTarget(): void {
    this.timer.restartCurrentTarget();
    this.updateRing(0);
  }

  dispose(): void {
    this.el.removeEventListener('ixr-cursor-hover-start', this.onHoverStart);
    this.el.removeEventListener('ixr-cursor-hover-end', this.onHoverEnd);
    if (this.ringMesh) {
      this.ringMesh.removeFromParent();
      this.ringMesh.geometry.dispose();
      this.ringMesh.material.dispose();
      this.ringMesh = null;
    }
  }

  private createRingMesh(): void {
    const THREE = AFRAME.THREE;
    const geometry = new THREE.RingGeometry(
      this.data.ringInnerRadius,
      this.data.ringOuterRadius,
      32,
      1,
      Math.PI / 2,
      0.001,
    );
    const material = new THREE.MeshBasicMaterial({
      color: this.data.ringColor,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    this.ringMesh = new THREE.Mesh(geometry, material);
    this.ringMesh.position.set(0, 0, -0.998);
    this.ringMesh.visible = false;
    this.el.object3D.add(this.ringMesh);
  }

  private updateRing(progress: number): void {
    if (!this.ringMesh) return;
    const rounded = Math.round(progress * 60) / 60;
    if (rounded === this.lastProgress) return;
    this.lastProgress = rounded;

    if (rounded <= 0 || rounded >= 1) {
      this.ringMesh.visible = false;
      return;
    }

    const THREE = AFRAME.THREE;
    const thetaLength = Math.max(0.02, rounded * Math.PI * 2);
    const nextGeometry = new THREE.RingGeometry(
      this.data.ringInnerRadius,
      this.data.ringOuterRadius,
      32,
      1,
      Math.PI / 2,
      -thetaLength,
    );
    this.ringMesh.geometry.dispose();
    this.ringMesh.geometry = nextGeometry;
    this.ringMesh.visible = true;
  }
}

AFRAME.registerComponent<DwellComponent>('imx-dwell', {
  schema: {
    durationMs: { type: 'number', default: DWELL_DURATION_MS },
    ringInnerRadius: { type: 'number', default: 0.017 },
    ringOuterRadius: { type: 'number', default: 0.022 },
    ringColor: { type: 'color', default: '#38BDF8' },
  },
  init() {
    this.controller = new DwellComponentController(this.el, this.data);
  },
  tick(_time, timeDelta) {
    this.controller?.tick(timeDelta);
  },
  remove() {
    this.controller?.dispose();
  },
});
