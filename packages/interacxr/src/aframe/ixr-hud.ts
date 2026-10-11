import AFRAME, { type Component, type Entity } from 'aframe';

import '../core/globals';

interface HudData {
  position: string;
  width: number;
  color: string;
  debugColor: string;
  showDebug: boolean;
}

export interface HudComponent extends Component<HudData> {
  controller?: HudController;
}

interface ModeChangeDetail {
  mode: string;
}

const MODE_LABELS: Record<string, string> = {
  idle: 'Idle',
  grab: 'Grab',
  teleport: 'Teleport',
  point: 'Point',
};

function createText(attributes: Record<string, unknown>): Entity {
  const text = document.createElement('a-text') as Entity;
  for (const [name, value] of Object.entries(attributes)) text.setAttribute(name, value);
  return text;
}

export class HudController {
  private readonly text: Entity;
  private readonly debug: Entity;
  private readonly onModeChange = (event: Event): void => {
    const mode = (event as CustomEvent<ModeChangeDetail>).detail.mode;
    this.setText(MODE_LABELS[mode] ?? mode);
  };

  constructor(el: Entity, data: HudData) {
    this.text = createText({
      position: data.position,
      align: 'center',
      width: data.width,
      value: 'Idle',
      color: data.color,
    });
    el.appendChild(this.text);
    this.debug = createText({
      position: '0 -0.62 -1',
      align: 'center',
      width: 2.5,
      value: '',
      color: data.debugColor,
      visible: data.showDebug,
    });
    el.appendChild(this.debug);
    window.ixrHUD = this;
    window.addEventListener('ixr-mode-change', this.onModeChange);
  }

  setText(value: string): void {
    this.text.setAttribute('value', value);
  }

  setDebug(value: string): void {
    this.debug.setAttribute('value', value);
  }

  clearDebug(): void {
    this.debug.setAttribute('value', '');
  }

  dispose(): void {
    window.removeEventListener('ixr-mode-change', this.onModeChange);
  }
}

AFRAME.registerComponent<HudComponent>('ixr-hud', {
  schema: {
    position: { type: 'string', default: '0 -0.5 -1' },
    width: { type: 'number', default: 2 },
    color: { type: 'string', default: '#FFFFFF' },
    debugColor: { type: 'string', default: '#00FFAA' },
    showDebug: { type: 'boolean', default: true },
  },
  init() {
    this.controller = new HudController(this.el, this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
