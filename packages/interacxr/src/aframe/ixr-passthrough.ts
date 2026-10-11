import AFRAME, { type Component, type Entity } from 'aframe';

import { logger } from '../core/logger';
import { PassthroughLayer } from '../passthrough/passthrough-layer';
import { MASK_MODE, type MaskMode } from '../passthrough/passthrough-shader';
import { CALIBRATION_CHANGE_EVENT, getInteracxrSystem } from './interacxr-system';

type MaskModeName = 'full' | 'bottom-window';

interface PassthroughData {
  opacity: number;
  maskMode: MaskModeName;
  feather: number;
}

export interface PassthroughComponent extends Component<PassthroughData> {
  controller?: PassthroughController;
}

const MASK_MODES: Record<MaskModeName, MaskMode> = {
  full: MASK_MODE.FULL,
  'bottom-window': MASK_MODE.BOTTOM_WINDOW,
};

// deve ser colocado na entidade da câmera, para que o plano fique preso à cabeça
export class PassthroughController {
  private layer: PassthroughLayer | null = null;
  private readonly onCalibrationChange = (): void => {
    const system = getInteracxrSystem(this.el);
    this.layer?.resize(system.projectionPlane);
    this.layer?.setK1(system.calibration.k1);
  };

  constructor(
    private readonly el: Entity,
    private data: PassthroughData,
  ) {
    el.sceneEl.addEventListener(CALIBRATION_CHANGE_EVENT, this.onCalibrationChange);
  }

  get passthroughLayer(): PassthroughLayer | null {
    return this.layer;
  }

  async startCamera(): Promise<void> {
    try {
      const system = getInteracxrSystem(this.el);
      // o vídeo é o mesmo usado pelo rastreamento de mãos (camera service compartilhado)
      const video = await system.startCamera();
      this.layer ??= new PassthroughLayer(video, system.projectionPlane, {
        k1: system.calibration.k1,
      });
      this.layer.attachTo(this.el.object3D);
      this.update(this.data);
    } catch (error) {
      logger.error('camera permission is required for passthrough', error);
    }
  }

  update(data: PassthroughData): void {
    this.data = data;
    this.layer?.setOpacity(data.opacity);
    this.layer?.setMaskMode(MASK_MODES[data.maskMode]);
    this.layer?.setFeather(data.feather);
  }

  dispose(): void {
    this.el.sceneEl.removeEventListener(CALIBRATION_CHANGE_EVENT, this.onCalibrationChange);
    this.layer?.dispose();
    this.layer = null;
  }
}

AFRAME.registerComponent<PassthroughComponent>('ixr-passthrough', {
  schema: {
    opacity: { type: 'number', default: 1 },
    maskMode: { type: 'string', default: 'full', oneOf: ['full', 'bottom-window'] },
    feather: { type: 'number', default: 0.08 },
  },
  init() {
    this.controller = new PassthroughController(this.el, this.data);
  },
  update() {
    this.controller?.update(this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
