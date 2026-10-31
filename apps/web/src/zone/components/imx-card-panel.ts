import AFRAME, { type Component, type Entity } from 'aframe';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { ZoneTheme } from '../config/constants';
import { formatCardCitation } from '../systems/flashcard-state';
import {
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';
import type { PanelComponent } from './imx-panel';

export { formatCardCitation };

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

function createSubEntity(tag: string, attributes: Record<string, unknown>): Entity {
  const el = document.createElement(tag) as Entity;
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value);
  }
  return el;
}

function createTroikaText(
  value: string,
  options: {
    position: string;
    fontSize?: number;
    maxWidth?: number;
    color?: string;
    align?: string;
    anchor?: string;
    baseline?: string;
    lineHeight?: number;
  },
): Entity {
  const el = document.createElement('a-troika-text') as Entity;
  const align = options.align ?? 'center';
  const anchor = options.anchor ?? 'center';
  const baseline = options.baseline ?? 'center';
  const fontSize = options.fontSize ?? 0.02;
  const maxWidth = options.maxWidth ?? 0.54;
  const lineHeight = options.lineHeight ?? 1.35;
  const color = options.color ?? '#FFFFFF';

  el.setAttribute('position', options.position);
  el.setAttribute('value', value);
  el.setAttribute('color', color);
  el.setAttribute('align', align);
  el.setAttribute('anchor', anchor);
  el.setAttribute('baseline', baseline);
  el.setAttribute('font-size', String(fontSize));
  el.setAttribute('fontSize', String(fontSize));
  el.setAttribute('max-width', String(maxWidth));
  el.setAttribute('maxWidth', String(maxWidth));
  el.setAttribute('line-height', String(lineHeight));
  el.setAttribute(
    'troika-text',
    `value: ${value}; color: ${color}; fontSize: ${fontSize}; maxWidth: ${maxWidth}; lineHeight: ${lineHeight}; align: ${align}; anchor: ${anchor}; baseline: ${baseline}`,
  );
  return el;
}

// especialização de painel espacial para flashcard interativo com transição fade entre pergunta e resposta
export class CardPanelController {
  private readonly rootGroupEl: Entity;
  private currentTheme: ZoneTheme;
  private isRevealed = false;
  private isFading = false;
  private fadeAnimFrameId: number | null = null;

  private badgeEl: Entity | null = null;
  private centerTextEl: Entity | null = null;
  private buttonRootEl: Entity | null = null;
  private buttonBgEl: Entity | null = null;
  private buttonBorderEl: Entity | null = null;
  private buttonTextEl: Entity | null = null;

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme) {
      this.currentTheme = detail.theme;
      this.applyThemeColors();
    }
  };

  constructor(
    private readonly el: Entity,
    private data: CardPanelData,
  ) {
    let storedPref: string | null = null;
    try {
      storedPref = localStorage.getItem(ZONE_THEME_STORAGE_KEY);
    } catch {
      // ignora caso localStorage não esteja acessível
    }
    this.currentTheme = resolveInitialTheme(storedPref);

    this.rootGroupEl = document.createElement('a-entity') as Entity;
    this.rootGroupEl.setAttribute('position', '0 0 0.015');
    this.el.appendChild(this.rootGroupEl);

    this.syncToPanel();
    this.render();

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
  }

  getIsRevealed(): boolean {
    return this.isRevealed;
  }

  isRevealedState(): boolean {
    return this.isRevealed;
  }

  update(data: CardPanelData): void {
    this.data = data;
    this.syncToPanel();
    this.updateContentValues();
  }

  reveal(): void {
    if (!this.isRevealed) {
      this.toggleReveal();
    }
  }

  hide(): void {
    if (this.isRevealed) {
      this.toggleReveal();
    }
  }

  toggleReveal(): void {
    if (this.isFading) return;

    if (typeof requestAnimationFrame === 'undefined') {
      this.isRevealed = !this.isRevealed;
      this.updateContentValues();
      return;
    }

    this.isFading = true;
    const targetRevealed = !this.isRevealed;
    const fadeOutDurationMs = 150;
    const fadeInDurationMs = 160;
    const startFadeOut = performance.now();

    const onFadeOutFrame = (now: number): void => {
      const elapsed = now - startFadeOut;
      const progress = Math.min(1, elapsed / fadeOutDurationMs);
      const currentOpacity = 1 - progress;

      this.setElementOpacity(this.centerTextEl, currentOpacity);
      this.setElementOpacity(this.badgeEl, currentOpacity);

      if (progress < 1) {
        this.fadeAnimFrameId = requestAnimationFrame(onFadeOutFrame);
      } else {
        // ponto intermediário: troca o estado e o conteúdo textual
        this.isRevealed = targetRevealed;
        this.updateContentValues();
        this.setElementOpacity(this.centerTextEl, 0);
        this.setElementOpacity(this.badgeEl, 0);

        const startFadeIn = performance.now();
        const onFadeInFrame = (inNow: number): void => {
          const inElapsed = inNow - startFadeIn;
          const inProgress = Math.min(1, inElapsed / fadeInDurationMs);

          this.setElementOpacity(this.centerTextEl, inProgress);
          this.setElementOpacity(this.badgeEl, inProgress);

          if (inProgress < 1) {
            this.fadeAnimFrameId = requestAnimationFrame(onFadeInFrame);
          } else {
            this.setElementOpacity(this.centerTextEl, 1);
            this.setElementOpacity(this.badgeEl, 1);
            this.isFading = false;
            this.fadeAnimFrameId = null;
          }
        };

        this.fadeAnimFrameId = requestAnimationFrame(onFadeInFrame);
      }
    };

    this.fadeAnimFrameId = requestAnimationFrame(onFadeOutFrame);
  }

  dispose(): void {
    if (this.fadeAnimFrameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.fadeAnimFrameId);
      this.fadeAnimFrameId = null;
    }
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    this.rootGroupEl.remove();
  }

  private setElementOpacity(el: Entity | null, opacity: number): void {
    if (!el) return;
    const clamped = Math.max(0, Math.min(1, opacity));
    el.setAttribute('troika-text', 'fillOpacity', clamped);
    el.setAttribute('troika-text', 'outlineOpacity', clamped);
    const comp = el.components?.['troika-text'] as
      | { troikaTextMesh?: { fillOpacity?: number; outlineOpacity?: number; sync?: () => void } }
      | undefined;
    if (comp?.troikaTextMesh) {
      comp.troikaTextMesh.fillOpacity = clamped;
      comp.troikaTextMesh.outlineOpacity = clamped;
      comp.troikaTextMesh.sync?.();
    }
  }

  private syncToPanel(): void {
    const footer = this.data.sourceTitle
      ? formatCardCitation(this.data.sourceTitle, this.data.sourcePage)
      : '';
    const panel = this.el.components['imx-panel'] as PanelComponent | undefined;
    if (panel?.controller) {
      this.el.setAttribute('imx-panel', 'title', '');
      this.el.setAttribute('imx-panel', 'body', '');
      this.el.setAttribute('imx-panel', 'footer', footer);
      if (this.data.accentColor) {
        this.el.setAttribute('imx-panel', 'accentColor', this.data.accentColor);
      }
      return;
    }
    this.el.setAttribute('imx-panel', {
      panelId: this.el.id || this.data.cardId,
      title: '',
      body: '',
      footer,
      accentColor: this.data.accentColor,
    });
  }

  private render(): void {
    while (this.rootGroupEl.firstChild) {
      this.rootGroupEl.removeChild(this.rootGroupEl.firstChild);
    }

    const isLight = this.currentTheme === 'light-glass';
    const accentColor = this.data.accentColor || '#0284C7';
    const buttonBgColor = isLight ? '#F1F5F9' : '#1E293B';

    // 1. badge superior de contexto
    const badgeLabel = this.isRevealed
      ? this.data.title.length > 40
        ? `${this.data.title.slice(0, 38).trimEnd()}..`
        : this.data.title
      : (PT_BR.zone.panels.flashcardBadge ?? 'FLASHCARD');

    this.badgeEl = createTroikaText(badgeLabel, {
      position: '0 0.165 0.002',
      fontSize: this.isRevealed ? 0.015 : 0.014,
      maxWidth: 0.54,
      color: accentColor,
      align: 'center',
      anchor: 'center',
    });
    this.rootGroupEl.appendChild(this.badgeEl);

    // 2. texto central (apenas o título quando oculto; descrição quando revelado)
    const initialText = this.isRevealed
      ? this.data.body || 'Sem descrição cadastrada.'
      : this.data.title;
    const initialFontSize = this.isRevealed ? 0.021 : 0.027;
    const initialColor = this.isRevealed
      ? isLight
        ? '#1E293B'
        : '#E2E8F0'
      : isLight
        ? '#0F172A'
        : '#F8FAFC';

    this.centerTextEl = createTroikaText(initialText, {
      position: '0 0.035 0.003',
      fontSize: initialFontSize,
      maxWidth: 0.54,
      lineHeight: this.isRevealed ? 1.38 : 1.32,
      color: initialColor,
      align: 'center',
      anchor: 'center',
      baseline: 'center',
    });
    this.rootGroupEl.appendChild(this.centerTextEl);

    // 3. botão de ação alternável embaixo do texto (revelar / ocultar)
    this.buttonRootEl = createSubEntity('a-entity', {
      position: '0 -0.105 0.006',
    });

    this.buttonBorderEl = createSubEntity('a-entity', {
      geometry: 'primitive: rounded-rect; width: 0.288; height: 0.064; radius: 0.016',
      position: '0 0 -0.001',
      material: `color: ${accentColor}; shader: flat; opacity: 0.92; transparent: true`,
    });

    this.buttonBgEl = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: 'primitive: rounded-rect; width: 0.28; height: 0.056; radius: 0.014',
      material: `color: ${buttonBgColor}; shader: flat; opacity: 0.98; transparent: true`,
    });

    const buttonLabel = this.isRevealed
      ? (PT_BR.zone.panels.flashcardHide ?? 'Ocultar')
      : (PT_BR.zone.panels.flashcardReveal ?? 'Revelar');

    this.buttonTextEl = createTroikaText(buttonLabel, {
      position: '0 0 0.003',
      fontSize: 0.02,
      maxWidth: 0.26,
      color: accentColor,
      align: 'center',
      anchor: 'center',
    });

    this.buttonBgEl.addEventListener('mouseenter', () => {
      this.buttonRootEl?.setAttribute('scale', '1.05 1.05 1');
    });
    this.buttonBgEl.addEventListener('mouseleave', () => {
      this.buttonRootEl?.setAttribute('scale', '1 1 1');
    });
    this.buttonBgEl.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      this.toggleReveal();
    });

    this.buttonBgEl.appendChild(this.buttonTextEl);
    this.buttonRootEl.appendChild(this.buttonBorderEl);
    this.buttonRootEl.appendChild(this.buttonBgEl);
    this.rootGroupEl.appendChild(this.buttonRootEl);
  }

  private updateContentValues(): void {
    if (!this.centerTextEl || !this.buttonTextEl || !this.badgeEl) return;
    const isLight = this.currentTheme === 'light-glass';
    const titleColor = isLight ? '#0F172A' : '#F8FAFC';
    const bodyColor = isLight ? '#1E293B' : '#E2E8F0';
    const accentColor = this.data.accentColor || '#0284C7';

    if (this.isRevealed) {
      const bodyText = this.data.body || 'Sem descrição cadastrada.';
      this.updateTroikaEntity(this.centerTextEl, {
        value: bodyText,
        fontSize: 0.021,
        color: bodyColor,
        lineHeight: 1.38,
      });

      const titleReminder =
        this.data.title.length > 40
          ? `${this.data.title.slice(0, 38).trimEnd()}..`
          : this.data.title;
      this.updateTroikaEntity(this.badgeEl, {
        value: titleReminder,
        fontSize: 0.015,
        color: accentColor,
      });

      const hideLabel = PT_BR.zone.panels.flashcardHide ?? 'Ocultar';
      this.updateTroikaEntity(this.buttonTextEl, {
        value: hideLabel,
        color: accentColor,
      });
    } else {
      this.updateTroikaEntity(this.centerTextEl, {
        value: this.data.title,
        fontSize: 0.027,
        color: titleColor,
        lineHeight: 1.32,
      });

      const badgeLabel = PT_BR.zone.panels.flashcardBadge ?? 'FLASHCARD';
      this.updateTroikaEntity(this.badgeEl, {
        value: badgeLabel,
        fontSize: 0.014,
        color: accentColor,
      });

      const revealLabel = PT_BR.zone.panels.flashcardReveal ?? 'Revelar';
      this.updateTroikaEntity(this.buttonTextEl, {
        value: revealLabel,
        color: accentColor,
      });
    }
  }

  private applyThemeColors(): void {
    if (!this.buttonBgEl || !this.buttonBorderEl) return;
    const isLight = this.currentTheme === 'light-glass';
    const accentColor = this.data.accentColor || '#0284C7';
    const buttonBgColor = isLight ? '#F1F5F9' : '#1E293B';

    this.buttonBgEl.setAttribute(
      'material',
      `color: ${buttonBgColor}; shader: flat; opacity: 0.98; transparent: true`,
    );
    this.buttonBorderEl.setAttribute(
      'material',
      `color: ${accentColor}; shader: flat; opacity: 0.92; transparent: true`,
    );

    this.updateContentValues();
  }

  private updateTroikaEntity(
    el: Entity,
    options: { value?: string; color?: string; fontSize?: number; lineHeight?: number },
  ): void {
    if (options.value !== undefined) {
      el.setAttribute('value', options.value);
      el.setAttribute('troika-text', 'value', options.value);
    }
    if (options.color !== undefined) {
      el.setAttribute('color', options.color);
      el.setAttribute('troika-text', 'color', options.color);
    }
    if (options.fontSize !== undefined) {
      el.setAttribute('font-size', String(options.fontSize));
      el.setAttribute('fontSize', String(options.fontSize));
      el.setAttribute('troika-text', 'fontSize', options.fontSize);
    }
    if (options.lineHeight !== undefined) {
      el.setAttribute('line-height', String(options.lineHeight));
      el.setAttribute('lineHeight', String(options.lineHeight));
      el.setAttribute('troika-text', 'lineHeight', options.lineHeight);
    }
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
  remove() {
    this.controller?.dispose();
  },
});
