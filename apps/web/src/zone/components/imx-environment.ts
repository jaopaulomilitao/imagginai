import AFRAME, { type Component, type Entity } from 'aframe';

import {
  DEFAULT_ENVIRONMENT_PRESET,
  ENVIRONMENT_PALETTES,
  ENVIRONMENT_PRESETS,
  type EnvironmentPalette,
  type EnvironmentPreset,
} from '../config/constants';
import { isEnvironmentPreset } from '../config/zone-params';

interface EnvironmentData {
  preset: EnvironmentPreset;
  opacity: number;
}

export interface EnvironmentComponent extends Component<EnvironmentData> {
  controller?: EnvironmentController;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function createEntity(tag: string, attributes: Record<string, unknown>): Entity {
  const el = document.createElement(tag) as Entity;
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

// gerencia o céu, piso e iluminação dos presets focus-dark e focus-nature com opacidade controlada
export class EnvironmentController {
  private readonly skyEl: Entity;
  private readonly groundEl: Entity;
  private readonly ringEl: Entity;
  private readonly lightEl: Entity;
  private currentPreset: EnvironmentPreset;
  private currentOpacity: number;

  constructor(
    private readonly hostEl: Entity,
    data: EnvironmentData,
  ) {
    this.currentPreset = isEnvironmentPreset(data.preset)
      ? data.preset
      : DEFAULT_ENVIRONMENT_PRESET;
    this.currentOpacity = clampUnit(data.opacity);
    const palette = ENVIRONMENT_PALETTES[this.currentPreset];

    this.skyEl = createEntity('a-sky', {
      radius: 30,
      material: `color: ${palette.skyColor}; shader: flat; side: back; transparent: true; opacity: ${this.currentOpacity}`,
    });
    this.groundEl = createEntity('a-circle', {
      position: '0 0.01 0',
      rotation: '-90 0 0',
      radius: 12,
      material: `color: ${palette.groundColor}; shader: flat; transparent: true; opacity: ${this.currentOpacity}`,
    });
    this.ringEl = createEntity('a-ring', {
      position: '0 0.02 0',
      rotation: '-90 0 0',
      'radius-inner': 1.95,
      'radius-outer': 2.02,
      material: `color: ${palette.horizonRingColor}; shader: flat; transparent: true; opacity: ${this.currentOpacity}`,
    });
    this.lightEl = createEntity('a-entity', {
      light: `type: ambient; color: ${palette.ambientLightColor}; intensity: ${palette.ambientLightIntensity}`,
    });

    this.hostEl.appendChild(this.skyEl);
    this.hostEl.appendChild(this.groundEl);
    this.hostEl.appendChild(this.ringEl);
    this.hostEl.appendChild(this.lightEl);
    this.applyVisibility();
  }

  get preset(): EnvironmentPreset {
    return this.currentPreset;
  }

  get opacity(): number {
    return this.currentOpacity;
  }

  update(data: EnvironmentData): void {
    const nextPreset = isEnvironmentPreset(data.preset) ? data.preset : DEFAULT_ENVIRONMENT_PRESET;
    const nextOpacity = clampUnit(data.opacity);
    const presetChanged = nextPreset !== this.currentPreset;
    const opacityChanged = nextOpacity !== this.currentOpacity;
    this.currentPreset = nextPreset;
    this.currentOpacity = nextOpacity;
    if (presetChanged || opacityChanged) {
      this.applyPalette(ENVIRONMENT_PALETTES[this.currentPreset]);
    }
    this.applyVisibility();
  }

  setOpacity(opacity: number): void {
    const clamped = clampUnit(opacity);
    if (clamped === this.currentOpacity) return;
    this.currentOpacity = clamped;
    this.applyPalette(ENVIRONMENT_PALETTES[this.currentPreset]);
    this.applyVisibility();
  }

  dispose(): void {
    this.skyEl.remove();
    this.groundEl.remove();
    this.ringEl.remove();
    this.lightEl.remove();
  }

  private applyPalette(palette: EnvironmentPalette): void {
    this.skyEl.setAttribute(
      'material',
      `color: ${palette.skyColor}; shader: flat; side: back; transparent: true; opacity: ${this.currentOpacity}`,
    );
    this.groundEl.setAttribute(
      'material',
      `color: ${palette.groundColor}; shader: flat; transparent: true; opacity: ${this.currentOpacity}`,
    );
    this.ringEl.setAttribute(
      'material',
      `color: ${palette.horizonRingColor}; shader: flat; transparent: true; opacity: ${this.currentOpacity}`,
    );
    this.lightEl.setAttribute(
      'light',
      `type: ambient; color: ${palette.ambientLightColor}; intensity: ${palette.ambientLightIntensity}`,
    );
  }

  private applyVisibility(): void {
    const visible = this.currentOpacity > 0;
    this.skyEl.setAttribute('visible', visible);
    this.groundEl.setAttribute('visible', visible);
    this.ringEl.setAttribute('visible', visible);
  }
}

AFRAME.registerComponent<EnvironmentComponent>('imx-environment', {
  schema: {
    preset: {
      type: 'string',
      default: DEFAULT_ENVIRONMENT_PRESET,
      oneOf: [...ENVIRONMENT_PRESETS],
    },
    opacity: { type: 'number', default: 1 },
  },
  init() {
    this.controller = new EnvironmentController(this.el, this.data);
  },
  update() {
    this.controller?.update(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
