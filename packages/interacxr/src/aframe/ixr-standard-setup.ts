import AFRAME, { type Component, type Entity } from 'aframe';

interface StandardSetupData {
  rig: string;
}

export type StandardSetupComponent = Component<StandardSetupData>;

function defaultComponents(cameraId: string, rig: string): [string, string][] {
  return [
    ['ixr-hand-tracking', 'maxHands: 2'],
    ['ixr-gesture-detector', `source: ${cameraId}`],
    ['ixr-hand-model', `source: ${cameraId}`],
    ['ixr-cursor', 'targetClass: .grabbable, .interactable, .rotatable'],
    ['ixr-gaze-grabber', 'targetClass: .grabbable; activationPose: victory; grabPose: grab'],
    ['ixr-interactor', 'targetClass: .interactable; interactPose: pinch'],
    [
      'ixr-teleport',
      `rig: ${rig}; activationPose: rock; confirmPose: pinch; cancelPose: grab; floorY: 0`,
    ],
  ];
}

// apenas configura os componentes; a interface de início e a sessão vr pertencem à aplicação,
// que chama getInteracxrSystem(scene).start() a partir de um gesto do usuário
function addDefaultComponents(el: Entity, rig: string): void {
  // é garantido que a câmera possua um id para referenciar os componentes
  if (!el.id) el.id = 'ixr-default-camera';
  for (const [name, value] of defaultComponents(`#${el.id}`, rig)) {
    // são preservados os componentes já declarados pelo usuário
    if (!el.hasAttribute(name)) el.setAttribute(name, value);
  }
}

AFRAME.registerComponent<StandardSetupComponent>('ixr-standard-setup', {
  schema: {
    rig: { type: 'string', default: '#camera-rig' },
  },
  init() {
    addDefaultComponents(this.el, this.data.rig);
  },
});
