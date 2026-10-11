import AFRAME, { type Entity, type System } from 'aframe';

import {
  CalibrationProfile,
  type CalibrationSettings,
  type ProjectionPlane,
} from '../calibration/calibration-profile';
import { CameraService } from '../core/camera-service';
import { InteractionManager } from '../core/interaction-manager';

export const INTERACXR_SYSTEM = 'interacxr';
export const CALIBRATION_CHANGE_EVENT = 'ixr-calibration-change';
export const CAMERA_READY_EVENT = 'ixr-camera-ready';
export const CAMERA_STOPPED_EVENT = 'ixr-camera-stopped';

export interface CameraReadyDetail {
  video: HTMLVideoElement;
}

// proporção usada até o vídeo real informar suas dimensões
const FALLBACK_VIDEO_SIZE = { width: 1280, height: 720 };

// instâncias compartilhadas por cena, no lugar de estado global em window
export interface InteracxrSystem extends System {
  camera: CameraService;
  interaction: InteractionManager;
  calibration: CalibrationProfile;
  projectionPlane: ProjectionPlane;
  // chamado pela aplicação (a partir de um gesto do usuário); a biblioteca não cria interface
  start(): Promise<HTMLVideoElement>;
  stop(): void;
  setCalibration(settings: Partial<CalibrationSettings>): void;
  refreshProjection(): void;
}

export function getInteracxrSystem(el: Entity): InteracxrSystem {
  const system = el.sceneEl.systems[INTERACXR_SYSTEM];
  if (!system) throw new Error(`a-frame system "${INTERACXR_SYSTEM}" is not registered`);
  return system as InteracxrSystem;
}

AFRAME.registerSystem<InteracxrSystem>(INTERACXR_SYSTEM, {
  init() {
    this.camera = new CameraService();
    this.interaction = new InteractionManager();
    this.calibration = new CalibrationProfile();
    this.projectionPlane = this.calibration.projectionPlane(
      FALLBACK_VIDEO_SIZE.width,
      FALLBACK_VIDEO_SIZE.height,
    );

    this.start = async () => {
      const video = await this.camera.start();
      this.refreshProjection();
      const detail: CameraReadyDetail = { video };
      this.sceneEl.emit(CAMERA_READY_EVENT, detail);
      return video;
    };

    this.stop = () => {
      this.camera.stop();
      this.sceneEl.emit(CAMERA_STOPPED_EVENT);
    };

    this.setCalibration = (settings) => {
      this.calibration = new CalibrationProfile({ ...this.calibration.toJSON(), ...settings });
      this.refreshProjection();
    };

    this.refreshProjection = () => {
      const video = this.camera.video;
      const width = video?.videoWidth || FALLBACK_VIDEO_SIZE.width;
      const height = video?.videoHeight || FALLBACK_VIDEO_SIZE.height;
      this.projectionPlane = this.calibration.projectionPlane(width, height);
      this.sceneEl.emit(CALIBRATION_CHANGE_EVENT, this.projectionPlane);
    };
  },
});

// executa o callback quando o vídeo compartilhado estiver disponível (imediatamente, se já estiver)
export function onCameraReady(el: Entity, callback: (video: HTMLVideoElement) => void): () => void {
  const listener = (event: Event): void => {
    callback((event as CustomEvent<CameraReadyDetail>).detail.video);
  };
  el.sceneEl.addEventListener(CAMERA_READY_EVENT, listener);
  const current = getInteracxrSystem(el).camera.video;
  if (current) callback(current);
  return () => el.sceneEl.removeEventListener(CAMERA_READY_EVENT, listener);
}
