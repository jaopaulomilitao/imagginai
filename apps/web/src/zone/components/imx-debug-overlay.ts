import AFRAME, { type Component, type Entity } from 'aframe';
import type { HandTrackingComponent, HandTrackerStats } from 'interacxr';

import {
  DEBUG_HUD_UPDATE_INTERVAL_MS,
  DEFAULT_ZONE_MODE,
  type ZoneMode,
} from '../config/constants';
import { formatDebugText, FpsMeter } from '../config/zone-params';
import { ZONE_MODE_CHANGE_EVENT } from './imx-mode';
import type { ModeSnapshot } from '../systems/mode-controller';

interface DebugOverlayData {
  enabled: boolean;
  cameraSelector: string;
}

export interface DebugOverlayComponent extends Component<DebugOverlayData> {
  controller?: DebugOverlayController;
}

export { formatDebugText } from '../config/zone-params';

function createHudEntities(parent: Entity): { root: Entity; text: Entity } {
  const root = document.createElement('a-entity') as Entity;
  root.setAttribute('position', '0 0.28 -0.95');

  const bg = document.createElement('a-plane') as Entity;
  bg.setAttribute('width', 0.62);
  bg.setAttribute('height', 0.065);
  bg.setAttribute('material', 'color: #06090E; shader: flat; transparent: true; opacity: 0.72');
  root.appendChild(bg);

  const text = document.createElement('a-text') as Entity;
  text.setAttribute('position', '0 0 0.002');
  text.setAttribute('align', 'center');
  text.setAttribute('width', 0.95);
  text.setAttribute('color', '#38BDF8');
  text.setAttribute('value', '');
  root.appendChild(text);

  parent.appendChild(root);
  return { root, text };
}

// exibe fps, taxa de inferência da mão e modo atual dentro do visor xr apenas quando ?debug=1 está ativo
export class DebugOverlayController {
  private readonly fpsMeter = new FpsMeter();
  private hudRoot: Entity | null = null;
  private hudText: Entity | null = null;
  private domBadge: HTMLElement | null = null;
  private currentMode: ZoneMode = DEFAULT_ZONE_MODE;
  private accumulatedMs = 0;

  private readonly onModeChange = (event: Event): void => {
    const snapshot = (event as CustomEvent<ModeSnapshot>).detail;
    this.currentMode = snapshot.targetMode;
    this.refreshDisplay();
  };

  constructor(
    private readonly el: Entity,
    private data: DebugOverlayData,
  ) {
    this.el.sceneEl.addEventListener(ZONE_MODE_CHANGE_EVENT, this.onModeChange);
    this.domBadge = document.querySelector<HTMLElement>('#zone-debug-badge');
    this.syncEnabled();
  }

  update(data: DebugOverlayData): void {
    this.data = data;
    this.syncEnabled();
  }

  tick(deltaMs: number): void {
    if (!this.data.enabled) return;
    this.fpsMeter.recordFrame(deltaMs);
    this.accumulatedMs += deltaMs;
    if (this.accumulatedMs < DEBUG_HUD_UPDATE_INTERVAL_MS) return;
    this.accumulatedMs = 0;
    this.refreshDisplay();
  }

  dispose(): void {
    this.el.sceneEl.removeEventListener(ZONE_MODE_CHANGE_EVENT, this.onModeChange);
    this.hudRoot?.remove();
    this.hudRoot = null;
    this.hudText = null;
    if (this.domBadge) {
      this.domBadge.hidden = true;
    }
  }

  private syncEnabled(): void {
    if (this.data.enabled && !this.hudRoot) {
      const created = createHudEntities(this.el);
      this.hudRoot = created.root;
      this.hudText = created.text;
      if (this.domBadge) this.domBadge.hidden = false;
      this.refreshDisplay();
      return;
    }
    if (!this.data.enabled && this.hudRoot) {
      this.hudRoot.remove();
      this.hudRoot = null;
      this.hudText = null;
      if (this.domBadge) this.domBadge.hidden = true;
    }
  }

  private readTrackerStats(): HandTrackerStats | null {
    const cameraEl = this.el.sceneEl.querySelector<Entity>(this.data.cameraSelector);
    const tracking = cameraEl?.components['ixr-hand-tracking'] as HandTrackingComponent | undefined;
    return tracking?.controller?.tracker.stats ?? null;
  }

  private refreshDisplay(): void {
    if (!this.data.enabled) return;
    const stats = this.readTrackerStats();
    const formatted = formatDebugText({
      fps: this.fpsMeter.fps,
      inferenceHz: stats?.measuredHz ?? 0,
      targetHz: stats?.targetHz ?? 0,
      latencyMs: stats?.meanLatencyMs ?? 0,
      mode: this.currentMode,
    });
    this.hudText?.setAttribute('value', formatted);
    if (this.domBadge) {
      this.domBadge.textContent = formatted;
    }
  }
}

AFRAME.registerComponent<DebugOverlayComponent>('imx-debug-overlay', {
  schema: {
    enabled: { type: 'boolean', default: false },
    cameraSelector: { type: 'string', default: '#main-camera' },
  },
  init() {
    this.controller = new DebugOverlayController(this.el, this.data);
  },
  update() {
    this.controller?.update(this.data);
  },
  tick(_time, timeDelta) {
    this.controller?.tick(timeDelta);
  },
  remove() {
    this.controller?.dispose();
  },
});
