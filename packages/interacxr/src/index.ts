import './core/globals';
import './aframe/interacxr-system';
import './aframe/ixr-hud';
import './aframe/ixr-hand-tracking';
import './aframe/ixr-gesture-detector';
import './aframe/ixr-hand-model';
import './aframe/ixr-cursor';
import './aframe/ixr-gaze-grabber';
import './aframe/ixr-interactor';
import './aframe/ixr-teleport';
import './aframe/ixr-passthrough';
// o componente orquestrador
import './aframe/ixr-standard-setup';

export { InteractionManager } from './core/interaction-manager';
export type { HandDataDetail, HandLandmarks, Landmark } from './core/landmarks';
export { CameraService, DEFAULT_CAMERA_OPTIONS } from './core/camera-service';
export type { CameraServiceOptions } from './core/camera-service';
export { getInteracxrSystem, INTERACXR_SYSTEM } from './aframe/interacxr-system';
export type { InteracxrSystem } from './aframe/interacxr-system';
export { CalibrationProfile, DEFAULT_CALIBRATION } from './calibration/calibration-profile';
export type {
  CalibrationSettings,
  PlanePoint,
  ProjectionPlane,
} from './calibration/calibration-profile';
export { CALIBRATION_CHANGE_EVENT } from './aframe/interacxr-system';
export { DEFAULT_PASSTHROUGH_OPTIONS, PassthroughLayer } from './passthrough/passthrough-layer';
export type { PassthroughLayerOptions } from './passthrough/passthrough-layer';
export { MASK_MODE } from './passthrough/passthrough-shader';
export type { MaskMode } from './passthrough/passthrough-shader';
