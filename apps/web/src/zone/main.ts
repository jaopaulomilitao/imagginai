import AFRAME, { type Entity, type Scene } from 'aframe';
import 'interacxr';
import { getInteracxrSystem } from 'interacxr';

import './components/imx-environment';
import './components/imx-mode';
import './components/imx-debug-overlay';

import { PT_BR } from '../shared/i18n/pt-br';
import { logger } from '../shared/logger';
import {
  DEFAULT_CAMERA_VFOV_DEG,
  MODE_TRANSITION_DURATION_MS,
  PASSTHROUGH_PLANE_DISTANCE_M,
  RIG_ORIGIN,
} from './config/constants';
import { parseZoneParams } from './config/zone-params';

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`zone markup is missing ${selector}`);
  return element;
}

// aplica os parâmetros de execução (preset de ambiente, calibração unificada e modo debug)
function configureZoneScene(scene: Scene): void {
  const params = parseZoneParams(window.location.search);
  const rig = requireElement<Entity>('#camera-rig');
  rig.setAttribute('position', `${RIG_ORIGIN.x} ${RIG_ORIGIN.y} ${RIG_ORIGIN.z}`);

  const envEl = requireElement<Entity>('#zone-environment');
  envEl.setAttribute('imx-environment', 'preset', params.environment);

  const cameraEl = requireElement<Entity>('#main-camera');
  cameraEl.setAttribute('imx-debug-overlay', 'enabled', params.debug);

  const system = getInteracxrSystem(scene);
  system.setCalibration({
    camVFovDeg: DEFAULT_CAMERA_VFOV_DEG,
    planeDistanceM: PASSTHROUGH_PLANE_DISTANCE_M,
  });
}

async function startZoneSession(scene: Scene, overlay: HTMLElement): Promise<void> {
  await getInteracxrSystem(scene).start();
  await scene.enterVR();
  overlay.style.opacity = '0';
  window.setTimeout(() => {
    overlay.hidden = true;
  }, MODE_TRANSITION_DURATION_MS);
}

function setupStartOverlay(scene: Scene): void {
  const overlay = requireElement<HTMLElement>('#zone-start-overlay');
  const button = requireElement<HTMLButtonElement>('#zone-start-btn');
  const errorEl = requireElement<HTMLElement>('#zone-start-error');

  button.addEventListener('click', () => {
    errorEl.hidden = true;
    startZoneSession(scene, overlay).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error('failed to start zone session', error);
      errorEl.textContent = `${PT_BR.zone.startErrorPrefix} ${detail}`;
      errorEl.hidden = false;
    });
  });
}

function bootZone(): void {
  const scene = requireElement<Scene>('#zone-scene');
  setupStartOverlay(scene);
  if (scene.hasLoaded) {
    configureZoneScene(scene);
  } else {
    scene.addEventListener('loaded', () => configureZoneScene(scene), { once: true });
  }
  logger.info(`zone started with a-frame ${AFRAME.version}`);
}

bootZone();
