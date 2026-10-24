import AFRAME, { type Component, type Entity } from 'aframe';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { PanelComponent } from './imx-panel';

export interface CardPanelData {
  cardId: string;
  title: string;
  body: string;
  sourcePage: number;
  sourceTitle: string;
  accentColor: string;
}

export interface CardPanelComponent extends Component<CardPanelData> {
  controller?: CardPanelController;
}

export function formatCardCitation(sourceTitle: string, sourcePage: number): string {
  const shortTitle =
    sourceTitle.length > 34 ? `${sourceTitle.slice(0, 31).trimEnd()}...` : sourceTitle;
  return `${shortTitle} | ${PT_BR.zone.panels.sourceCitationPrefix} ${sourcePage}`;
}

// especialização de painel espacial para exibir um cartão ou item de estudo com citação de fonte verificada
export class CardPanelController {
  constructor(
    private readonly el: Entity,
    private data: CardPanelData,
  ) {
    this.syncToPanel();
  }

  update(data: CardPanelData): void {
    this.data = data;
    this.syncToPanel();
  }

  private syncToPanel(): void {
    const footer = this.data.sourceTitle
      ? formatCardCitation(this.data.sourceTitle, this.data.sourcePage)
      : '';
    const panel = this.el.components['imx-panel'] as PanelComponent | undefined;
    if (panel?.controller) {
      this.el.setAttribute('imx-panel', 'title', this.data.title);
      this.el.setAttribute('imx-panel', 'body', this.data.body);
      this.el.setAttribute('imx-panel', 'footer', footer);
      if (this.data.accentColor) {
        this.el.setAttribute('imx-panel', 'accentColor', this.data.accentColor);
      }
      return;
    }
    this.el.setAttribute('imx-panel', {
      panelId: this.el.id || this.data.cardId,
      title: this.data.title,
      body: this.data.body,
      footer,
      accentColor: this.data.accentColor,
    });
  }
}

AFRAME.registerComponent<CardPanelComponent>('imx-card-panel', {
  dependencies: ['imx-panel'],
  schema: {
    cardId: { type: 'string', default: '' },
    title: { type: 'string', default: '' },
    body: { type: 'string', default: '' },
    sourcePage: { type: 'int', default: 1 },
    sourceTitle: { type: 'string', default: '' },
    accentColor: { type: 'string', default: '' },
  },
  init() {
    this.controller = new CardPanelController(this.el, this.data);
  },
  update() {
    this.controller?.update(this.data);
  },
});
