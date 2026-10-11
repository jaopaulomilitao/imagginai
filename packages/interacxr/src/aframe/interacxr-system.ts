import AFRAME, { type Entity, type System } from 'aframe';

import { CameraService } from '../core/camera-service';

export const INTERACXR_SYSTEM = 'interacxr';

// instâncias compartilhadas por cena, no lugar de estado global em window
export interface InteracxrSystem extends System {
  camera: CameraService;
}

export function getInteracxrSystem(el: Entity): InteracxrSystem {
  const system = el.sceneEl.systems[INTERACXR_SYSTEM];
  if (!system) throw new Error(`a-frame system "${INTERACXR_SYSTEM}" is not registered`);
  return system as InteracxrSystem;
}

AFRAME.registerSystem<InteracxrSystem>(INTERACXR_SYSTEM, {
  init() {
    this.camera = new CameraService();
  },
});
