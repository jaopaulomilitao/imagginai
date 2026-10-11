import './core/globals';
import './aframe/ixr-hud';
import './aframe/ixr-hand-tracking';
import './aframe/ixr-gesture-detector';
import './aframe/ixr-hand-model';
import './aframe/ixr-cursor';
import './aframe/ixr-gaze-grabber';
import './aframe/ixr-interactor';
import './aframe/ixr-teleport';
import './aframe/xr-passthrough';
// o componente orquestrador
import './aframe/ixr-standard-setup';

export { InteractionManager } from './core/interaction-manager';
export type { HandDataDetail, HandLandmarks, Landmark } from './core/landmarks';
