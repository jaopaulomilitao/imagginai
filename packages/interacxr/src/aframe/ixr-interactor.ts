import AFRAME, { type Component, type Entity } from 'aframe';

import '../core/globals';
import type { CursorComponent } from './ixr-cursor';
import type { Vector3Like } from './entity-utils';

interface InteractorData {
  targetClass: string;
  interactPose: string;
}

export interface InteractorComponent extends Component<InteractorData> {
  controller?: InteractorController;
}

const PRESS_SCALE = 0.9;
const PRESS_DURATION_MS = 150;

export class InteractorController {
  private readonly onInteract = (): void => this.interact();

  constructor(
    private readonly el: Entity,
    private readonly data: InteractorData,
  ) {
    el.addEventListener(`ixr-${data.interactPose}-start`, this.onInteract);
  }

  dispose(): void {
    this.el.removeEventListener(`ixr-${this.data.interactPose}-start`, this.onInteract);
  }

  private cursor(): CursorComponent | undefined {
    return this.el.components['ixr-cursor'] as CursorComponent | undefined;
  }

  private interact(): void {
    if (!window.ixrInteractionManager.request('interact', this)) return;
    const hovered = this.cursor()?.controller?.getHoveredElement();
    if (hovered && hovered.matches(this.data.targetClass)) this.press(hovered);
    window.ixrInteractionManager.release(this);
  }

  private press(hovered: Entity): void {
    // a bolinha é preenchida simultaneamente ao clique
    this.cursor()?.controller?.setCursorActive(true);
    hovered.emit('click');

    // referência viva à escala, como no original (defeito 9: a restauração reaplica o valor já reduzido)
    const currentScale: Vector3Like = hovered.object3D.scale;
    hovered.setAttribute('scale', {
      x: currentScale.x * PRESS_SCALE,
      y: currentScale.y * PRESS_SCALE,
      z: currentScale.z * PRESS_SCALE,
    });

    setTimeout(() => {
      hovered.setAttribute('scale', currentScale);
      // a bolinha regressa ao anel assim que o pulso termina
      this.cursor()?.controller?.setCursorActive(false);
    }, PRESS_DURATION_MS);
  }
}

AFRAME.registerComponent<InteractorComponent>('ixr-interactor', {
  schema: {
    targetClass: { type: 'string', default: '.interactable' },
    interactPose: { type: 'string', default: 'pinch' },
  },
  init() {
    this.controller = new InteractorController(this.el, this.data);
  },
  remove() {
    this.controller?.dispose();
  },
});
