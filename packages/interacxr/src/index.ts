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
export type {
  InteractionListener,
  InteractionMode,
  InteractionState,
} from './core/interaction-manager';
export type { HandDataDetail, HandLandmarks, Landmark } from './core/landmarks';
export { CameraService, DEFAULT_CAMERA_OPTIONS } from './core/camera-service';
export type { CameraServiceOptions } from './core/camera-service';
export {
  CAMERA_READY_EVENT,
  CAMERA_STOPPED_EVENT,
  getInteracxrSystem,
  INTERACXR_SYSTEM,
  onCameraReady,
} from './aframe/interacxr-system';
export type { CameraReadyDetail, InteracxrSystem } from './aframe/interacxr-system';
export { CalibrationProfile, DEFAULT_CALIBRATION } from './calibration/calibration-profile';
export type {
  CalibrationSettings,
  PlanePoint,
  ProjectionPlane,
} from './calibration/calibration-profile';
export { CALIBRATION_CHANGE_EVENT } from './aframe/interacxr-system';
export { DEFAULT_PASSTHROUGH_OPTIONS, PassthroughLayer } from './passthrough/passthrough-layer';
export type { PassthroughLayerOptions } from './passthrough/passthrough-layer';
export { PassthroughController } from './aframe/ixr-passthrough';
export type { PassthroughComponent } from './aframe/ixr-passthrough';
export { MASK_MODE } from './passthrough/passthrough-shader';
export type { MaskMode } from './passthrough/passthrough-shader';
export {
  browserFrameCapture,
  DEFAULT_HAND_TRACKER_OPTIONS,
  DEFAULT_INPUT_WIDTH,
  HandTracker,
} from './core/hand-tracker';
export type {
  HandFrame,
  HandFrameListener,
  HandTrackerDependencies,
  HandTrackerOptions,
  HandTrackerStats,
} from './core/hand-tracker';
export {
  DEFAULT_INFERENCE_RATE,
  ECONOMY_INFERENCE_HZ,
  InferenceRateController,
} from './core/inference-rate';
export type { InferenceRateConfig } from './core/inference-rate';
export { DEFAULT_MODEL_PATH, DEFAULT_WASM_PATH } from './core/worker-protocol';
export { HAND_DATA_EVENT } from './aframe/ixr-hand-tracking';
export type { HandTrackingComponent } from './aframe/ixr-hand-tracking';
export { DEFAULT_ONE_EURO, LandmarkSmoother, OneEuroFilter } from './core/filters';
export type { OneEuroParams } from './core/filters';
export {
  classifyFrame,
  DEFAULT_POSE_CLASSIFIER_CONFIG,
  measureHand,
  POSE_NAMES,
  PoseClassifier,
} from './core/pose-classifier';
export type {
  HandMetrics,
  PoseClassifierConfig,
  PoseEvent,
  PoseFlags,
  PoseName,
  PosePhase,
  PoseUpdate,
} from './core/pose-classifier';
export { HAND_LOST_EVENT } from './aframe/ixr-gesture-detector';
export type { PosePayload } from './aframe/ixr-gesture-detector';
export { domObserverFactory, TargetCache } from './core/target-cache';
export type { ObserverFactory } from './core/target-cache';
export {
  DEFAULT_PRESS_DURATION_MS,
  DEFAULT_PRESS_SCALE,
  PressFeedback,
} from './core/press-feedback';
export type { Scale3, ScaleTarget } from './core/press-feedback';
export { TelemetryBus } from './telemetry/telemetry-bus';
export type {
  AnyTelemetryRecord,
  TelemetryEventMap,
  TelemetryPayload,
  TelemetryRecord,
} from './telemetry/telemetry-bus';
export { ReplayRecorder } from './replay/replay-recorder';
export { ReplayPlayer } from './replay/replay-player';
export type { ReplayHandler, ReplayPlayback, ReplayScheduler } from './replay/replay-player';
export { LANDMARK_SESSION_VERSION, parseLandmarkSession } from './replay/landmark-session';
export type { LandmarkSession, LandmarkSessionFrame } from './replay/landmark-session';
