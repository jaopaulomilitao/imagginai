import AFRAME, { type Component, type Entity } from 'aframe';

import { PassthroughLayer } from '../passthrough/passthrough-layer';
import { MASK_MODE, type MaskMode } from '../passthrough/passthrough-shader';
import {
  CALIBRATION_CHANGE_EVENT,
  CAMERA_STOPPED_EVENT,
  getInteracxrSystem,
  onCameraReady,
} from './interacxr-system';

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
  private readonly stopListeningCamera: () => void;
  private readonly onCameraStopped = (): void => {
    this.layer?.dispose();
    this.layer = null;
  };
  private readonly onCalibrationChange = (): void => {
    const system = getInteracxrSystem(this.el);
    this.layer?.resize(system.projectionPlane);
    this.layer?.setK1(system.calibration.k1);
    this.layer?.setStereoOffset(system.calibration.stereoOffsetM);
  };

  constructor(
    private readonly el: Entity,
    private data: PassthroughData,
  ) {
    el.sceneEl.addEventListener(CALIBRATION_CHANGE_EVENT, this.onCalibrationChange);
    // o vídeo é o mesmo do rastreamento de mãos, ligado pela aplicação via system.start
    this.stopListeningCamera = onCameraReady(el, (video) => this.createLayer(video));
    el.sceneEl.addEventListener(CAMERA_STOPPED_EVENT, this.onCameraStopped);
  }

  get passthroughLayer(): PassthroughLayer | null {
    return this.layer;
  }

  private createLayer(video: HTMLVideoElement): void {
    if (this.layer) return;
    const system = getInteracxrSystem(this.el);
    this.layer = new PassthroughLayer(video, system.projectionPlane, {
      k1: system.calibration.k1,
      stereoOffsetM: system.calibration.stereoOffsetM,
    });
    this.layer.attachTo(this.el.object3D);
    this.update(this.data);
  }

  update(data: PassthroughData): void {
    this.data = data;
    this.layer?.setOpacity(data.opacity);
    this.layer?.setMaskMode(MASK_MODES[data.maskMode]);
    this.layer?.setFeather(data.feather);
  }

  dispose(): void {
    this.stopListeningCamera();
    this.el.sceneEl.removeEventListener(CAMERA_STOPPED_EVENT, this.onCameraStopped);
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
