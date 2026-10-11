import 'aframe';

import type { Entity, Scene } from 'aframe';
import { getInteracxrSystem } from 'interacxr';

import scenarioUrl from '../assets/scenario-interacxr.glb?url';
import { readRecordSeconds, recordHand, showRecording } from './recording';

const START_FADE_MS = 300;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`example markup is missing ${selector}`);
  return element;
}

// a interface de início pertence ao exemplo (aplicação), não à biblioteca
async function startExperience(scene: Scene, overlay: HTMLElement): Promise<void> {
  await getInteracxrSystem(scene).start();
  await scene.enterVR();
  overlay.style.opacity = '0';
  setTimeout(() => overlay.remove(), START_FADE_MS);
  const recordSeconds = readRecordSeconds(location.search);
  if (recordSeconds !== null) {
    const result = await recordHand(requireElement<Entity>('#main-camera'), recordSeconds);
    await showRecording(scene, result);
  }
}

function openDoor(button: Entity, door: Entity): void {
  button.setAttribute('color', '#8B0000');
  if (door.getAttribute('animation__open')) return;
  door.setAttribute('animation__open', {
    property: 'position',
    to: '-2.3 -2.5 1',
    dur: 2000,
    easing: 'easeInOutQuad',
  });
}

function setupDoor(): void {
  const button = requireElement<Entity>('#door-button');
  const door = requireElement<Entity>('#door');
  // a escala do botão é restaurada pelo próprio ixr-interactor após o clique
  button.addEventListener('click', () => openDoor(button, door), { once: true });
}

function setupStartScreen(scene: Scene): void {
  const overlay = requireElement<HTMLElement>('#start-screen');
  const errorText = requireElement<HTMLElement>('#start-error');
  requireElement<HTMLButtonElement>('#start-btn').addEventListener('click', () => {
    startExperience(scene, overlay).catch((error: unknown) => {
      errorText.hidden = false;
      errorText.textContent = `could not start: ${error instanceof Error ? error.message : String(error)}`;
    });
  });
}

const scene = requireElement<Scene>('a-scene');
requireElement<Entity>('#scenario').setAttribute('gltf-model', `url(${scenarioUrl})`);
setupStartScreen(scene);
if (scene.hasLoaded) setupDoor();
else scene.addEventListener('loaded', setupDoor, { once: true });
