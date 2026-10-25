import AFRAME, { type Entity, type Scene } from 'aframe';
import 'interacxr';
import { getInteracxrSystem } from 'interacxr';

import './components/imx-environment';
import './components/imx-mode';
import './components/imx-debug-overlay';
import './components/imx-panel';
import './components/imx-card-panel';
import './components/imx-pdf-panel';
import './components/imx-concept-graph';
import './components/imx-sequence-asset';
import './components/imx-quiz-panel';
import './components/imx-drag-handle';
import './components/imx-belt-menu';
import './systems/rounded-shape';

import { PT_BR } from '../shared/i18n/pt-br';
import { logger } from '../shared/logger';
import { ZoneWorkspaceController } from './components/zone-workspace';
import {
  DEFAULT_CAMERA_VFOV_DEG,
  DEFAULT_STEREO_EYE_OFFSET_M,
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

// aplica os parâmetros de execução, inicializa os 3 painéis iniciais e restaura o layout salvo no dexie
function configureZoneScene(scene: Scene): void {
  const params = parseZoneParams(window.location.search);
  const rig = requireElement<Entity>('#camera-rig');
  rig.setAttribute('position', `${RIG_ORIGIN.x} ${RIG_ORIGIN.y} ${RIG_ORIGIN.z}`);

  const envEl = requireElement<Entity>('#zone-environment');
  envEl.setAttribute('imx-environment', 'preset', params.environment);

  const cameraEl = requireElement<Entity>('#main-camera');
  cameraEl.setAttribute('imx-debug-overlay', 'enabled', params.debug);

  const beltEl = requireElement<Entity>('#zone-belt-menu');
  beltEl.setAttribute('imx-belt-menu', 'zoneId', params.zoneId);

  const system = getInteracxrSystem(scene);
  system.setCalibration({
    camVFovDeg: DEFAULT_CAMERA_VFOV_DEG,
    planeDistanceM: PASSTHROUGH_PLANE_DISTANCE_M,
    stereoOffsetM: DEFAULT_STEREO_EYE_OFFSET_M,
  });

  const panelsContainer = requireElement<Entity>('#zone-panels');
  const workspace = new ZoneWorkspaceController(scene, panelsContainer, params.zoneId);
  void workspace.init().catch((error: unknown) => {
    logger.error('failed to initialize zone workspace panels', error);
  });

  const syncRigHeight = (): void => {
    if (!scene.is('vr-mode')) {
      rig.object3D.position.y = RIG_ORIGIN.y;
      return;
    }
    // caso o webxr em vr aplique altura de chão (local-floor ~1.6m),
    // compensa no rig para manter o olhar do usuário alinhado em RIG_ORIGIN.y (1.2m)
    const cameraObj = cameraEl.getObject3D('camera');
    const cameraLocalY = cameraObj ? cameraObj.position.y : cameraEl.object3D.position.y;
    if (cameraLocalY > 0.3) {
      rig.object3D.position.y = RIG_ORIGIN.y - cameraLocalY;
    } else {
      rig.object3D.position.y = RIG_ORIGIN.y;
    }
  };

  scene.addEventListener('enter-vr', () => {
    syncRigHeight();
    window.setTimeout(syncRigHeight, 100);
    window.setTimeout(syncRigHeight, 500);
  });

  scene.addEventListener('exit-vr', () => {
    rig.object3D.position.y = RIG_ORIGIN.y;
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
