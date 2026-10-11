import AFRAME, { type Entity, type System } from 'aframe';

import {
  CalibrationProfile,
  type CalibrationSettings,
  type ProjectionPlane,
} from '../calibration/calibration-profile';
import { CameraService } from '../core/camera-service';

export const INTERACXR_SYSTEM = 'interacxr';
export const CALIBRATION_CHANGE_EVENT = 'ixr-calibration-change';

// proporção usada até o vídeo real informar suas dimensões
const FALLBACK_VIDEO_SIZE = { width: 1280, height: 720 };

// instâncias compartilhadas por cena, no lugar de estado global em window
export interface InteracxrSystem extends System {
  camera: CameraService;
  calibration: CalibrationProfile;
  projectionPlane: ProjectionPlane;
  startCamera(): Promise<HTMLVideoElement>;
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
    this.calibration = new CalibrationProfile();
    this.projectionPlane = this.calibration.projectionPlane(
      FALLBACK_VIDEO_SIZE.width,
      FALLBACK_VIDEO_SIZE.height,
    );

    this.startCamera = async () => {
      const video = await this.camera.start();
      this.refreshProjection();
      return video;
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
