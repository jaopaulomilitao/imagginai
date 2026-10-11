import AFRAME, { type Component, type Entity } from 'aframe';

import type { HandTrackingComponent } from './ixr-hand-tracking';

interface StandardSetupData {
  rig: string;
  createUI: boolean;
}

export type StandardSetupComponent = Component<StandardSetupData>;

const START_FADE_MS = 300;

function addDefaultComponents(el: Entity, rig: string): void {
  // é garantido que a câmera possua um id para referenciar os componentes
  if (!el.id) el.id = 'ixr-default-camera';
  const cameraId = `#${el.id}`;
  const defaults: [string, string][] = [
    ['ixr-hand-tracking', 'maxHands: 1'],
    ['ixr-gesture-detector', `source: ${cameraId}`],
    ['ixr-hand-model', `source: ${cameraId}`],
    ['ixr-cursor', 'targetClass: .grabbable, .interactable'],
    ['ixr-gaze-grabber', 'targetClass: .grabbable; activationPose: victory; grabPose: grab'],
    ['ixr-interactor', 'targetClass: .interactable; interactPose: pinch'],
    [
      'ixr-teleport',
      `rig: ${rig}; activationPose: rock; confirmPose: pinch; cancelPose: grab; floorY: 0`,
    ],
  ];
  // são injetados os componentes caso não tenham sido declarados pelo usuário
  for (const [name, value] of defaults) {
    if (!el.hasAttribute(name)) el.setAttribute(name, value);
  }
}

function injectStartUI(el: Entity): void {
  // é evitada a duplicidade caso a tela já exista
  if (document.getElementById('ixr-start-screen')) return;

  const overlay = document.createElement('div');
  overlay.id = 'ixr-start-screen';
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '100vw',
    height: '100vh',
    backgroundColor: 'rgba(15, 15, 15, 0.95)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '99999',
    fontFamily: 'sans-serif',
    color: '#ffffff',
    transition: 'opacity 0.3s ease',
  });

  const title = document.createElement('h1');
  title.innerText = 'InteracXR Toolkit';
  const subtitle = document.createElement('p');
  subtitle.innerText = 'allow camera access to start immersive webxr';
  const startButton = document.createElement('button');
  startButton.innerText = 'start experience';

  // é escutado o clique para liberar as permissões do navegador e iniciar a ia
  startButton.addEventListener('click', () => {
    const tracking = el.components['ixr-hand-tracking'] as HandTrackingComponent | undefined;
    if (!tracking?.controller) return;
    void tracking.controller.startTracking();
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), START_FADE_MS);
  });

  overlay.append(title, subtitle, startButton);
  document.body.appendChild(overlay);
}

AFRAME.registerComponent<StandardSetupComponent>('ixr-standard-setup', {
  schema: {
    rig: { type: 'string', default: '#camera-rig' },
    createUI: { type: 'boolean', default: true },
  },
  init() {
    addDefaultComponents(this.el, this.data.rig);
    // é gerada a interface inicial se habilitado
    if (this.data.createUI) injectStartUI(this.el);
  },
});
