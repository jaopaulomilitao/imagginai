import AFRAME, { type Component, type Entity } from 'aframe';

import type { InteractionManager } from '../core/interaction-manager';
import { PressFeedback, type ScaleTarget } from '../core/press-feedback';
import { getInteracxrSystem } from './interacxr-system';
import type { CursorComponent } from './ixr-cursor';

interface InteractorData {
  targetClass: string;
  interactPose: string;
}

export interface InteractorComponent extends Component<InteractorData> {
  controller?: InteractorController;
}

function scaleTargetOf(el: Entity): ScaleTarget {
  return {
    getScale: () => el.object3D.scale,
    // setAttribute mantém os dados do componente scale do a-frame sincronizados
    setScale: (scale) => el.setAttribute('scale', { ...scale }),
  };
}

export class InteractorController {
  private readonly interaction: InteractionManager;
  private readonly feedback = new PressFeedback<Entity>();
  private readonly onInteract = (): void => this.interact();

  constructor(
    private readonly el: Entity,
    private readonly data: InteractorData,
  ) {
    this.interaction = getInteracxrSystem(el).interaction;
    el.addEventListener(`ixr-${data.interactPose}-start`, this.onInteract);
  }

  dispose(): void {
    this.el.removeEventListener(`ixr-${this.data.interactPose}-start`, this.onInteract);
    this.feedback.restoreAll();
  }

  private cursor(): CursorComponent | undefined {
    return this.el.components['ixr-cursor'] as CursorComponent | undefined;
  }

  private interact(): void {
    if (!this.interaction.request('interact', this)) return;
    const hovered = this.cursor()?.controller?.getHoveredElement();
    if (hovered && hovered.matches(this.data.targetClass)) this.press(hovered);
    this.interaction.release(this);
  }

  private press(hovered: Entity): void {
    // a bolinha é preenchida simultaneamente ao clique
    this.cursor()?.controller?.setCursorActive(true);
    hovered.emit('click');

    // a bolinha regressa ao anel assim que o pulso termina
    this.feedback.press(hovered, scaleTargetOf(hovered), () =>
      this.cursor()?.controller?.setCursorActive(false),
    );
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
