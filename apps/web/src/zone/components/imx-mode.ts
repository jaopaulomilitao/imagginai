import AFRAME, { type Component, type Entity } from 'aframe';
import type { PassthroughComponent } from 'interacxr';

import type { EnvironmentComponent } from './imx-environment';
import {
  DEFAULT_ZONE_MODE,
  MODE_TRANSITION_DURATION_MS,
  ZONE_MODES,
  type ZoneMode,
} from '../config/constants';
import { ModeController, type ModeSnapshot } from '../systems/mode-controller';

export const ZONE_MODE_CHANGE_EVENT = 'imx-mode-change';

interface ModeComponentData {
  initialMode: ZoneMode;
  durationMs: number;
  cameraSelector: string;
  environmentSelector: string;
}

export interface ModeComponent extends Component<ModeComponentData> {
  controller?: ZoneModeBridge;
}

// integra o ModeController à cena a-frame, sincronizando opacidade de passthrough e ambiente
export class ZoneModeBridge {
  readonly modeController: ModeController;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly el: Entity,
    private data: ModeComponentData,
  ) {
    this.modeController = new ModeController(data.initialMode, data.durationMs);
    this.unsubscribe = this.modeController.subscribe((snapshot) => this.applySnapshot(snapshot));
    this.applySnapshot(this.modeController.snapshot);
  }

  tick(deltaMs: number): void {
    this.modeController.step(deltaMs);
  }

  toggle(): ModeSnapshot {
    return this.modeController.toggle();
  }

  setMode(mode: ZoneMode): ModeSnapshot {
    return this.modeController.setMode(mode);
  }

  dispose(): void {
    this.unsubscribe();
  }

  private applySnapshot(snapshot: ModeSnapshot): void {
    const cameraEl = this.el.sceneEl.querySelector<Entity>(this.data.cameraSelector);
    const passthrough = cameraEl?.components['ixr-passthrough'] as PassthroughComponent | undefined;
    if (passthrough?.controller?.passthroughLayer) {
      passthrough.controller.passthroughLayer.setOpacity(snapshot.passthroughOpacity);
    } else if (cameraEl?.hasAttribute('ixr-passthrough')) {
      cameraEl.setAttribute('ixr-passthrough', 'opacity', snapshot.passthroughOpacity);
    }

    const envEl = this.el.sceneEl.querySelector<Entity>(this.data.environmentSelector);
    const envComp = envEl?.components['imx-environment'] as EnvironmentComponent | undefined;
    if (envComp?.controller) {
      envComp.controller.setOpacity(snapshot.environmentOpacity);
    } else if (envEl?.hasAttribute('imx-environment')) {
      envEl.setAttribute('imx-environment', 'opacity', snapshot.environmentOpacity);
    }

    this.el.sceneEl.emit(ZONE_MODE_CHANGE_EVENT, snapshot);
  }
}

AFRAME.registerComponent<ModeComponent>('imx-mode', {
  schema: {
    initialMode: { type: 'string', default: DEFAULT_ZONE_MODE, oneOf: [...ZONE_MODES] },
    durationMs: { type: 'number', default: MODE_TRANSITION_DURATION_MS },
    cameraSelector: { type: 'string', default: '#main-camera' },
    environmentSelector: { type: 'string', default: '#zone-environment' },
  },
  init() {
    this.controller = new ZoneModeBridge(this.el, this.data);
  },
  tick(_time, timeDelta) {
    this.controller?.tick(timeDelta);
  },
  remove() {
    this.controller?.dispose();
  },
});
