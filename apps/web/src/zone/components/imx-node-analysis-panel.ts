import AFRAME, { type Component, type Entity } from 'aframe';

import type { StudyCard } from '../../shared/types/study-pack';
import type { ZoneTheme } from '../config/constants';
import type { NodeRelationItem } from '../systems/learning-assets-controller';
import {
  getThemePalette,
  resolveInitialTheme,
  ZONE_THEME_CHANGE_EVENT,
  ZONE_THEME_STORAGE_KEY,
} from '../systems/theme-controller';
import type { PanelComponent } from './imx-panel';

export const ZONE_GOTO_PDF_PAGE_EVENT = 'imx-zone-goto-pdf-page';
export const ZONE_SAVE_CARD_TO_DECK_EVENT = 'imx-zone-save-card';
export const ZONE_CREATE_SUBCONCEPT_EVENT = 'imx-zone-create-subconcept';

export interface ZoneGotoPdfPageDetail {
  readonly page: number;
}

export interface ZoneSaveCardToDeckDetail {
  readonly card: StudyCard;
}

export interface ZoneCreateSubconceptDetail {
  readonly parentConceptId: string;
  readonly parentLabel: string;
}

export interface NodeAnalysisData {
  conceptId: string;
  label: string;
  definition: string;
  sourcePage: number;
  sourceTitle: string;
  parents: readonly NodeRelationItem[];
  children: readonly NodeRelationItem[];
}

export interface NodeAnalysisPanelComponent extends Component<{ conceptId: string }> {
  controller?: NodeAnalysisPanelController;
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
  const align = options.align ?? 'left';
  const anchor = options.anchor ?? 'center';
  const baseline = options.baseline ?? 'center';
  const fontSize = options.fontSize ?? 0.016;
  const maxWidth = options.maxWidth ?? 0.64;
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

// painel espacial dedicado de análise de nó com navegação para página do pdf, destaques de relações e ação de salvar flashcard
export class NodeAnalysisPanelController {
  private readonly rootGroupEl: Entity;
  private currentTheme: ZoneTheme;
  private analysisData: NodeAnalysisData | null = null;
  private addFlashcardFeedbackTimer: number | null = null;

  private readonly onThemeChange = (event: Event): void => {
    const detail = (event as CustomEvent<{ theme: ZoneTheme }>).detail;
    if (detail?.theme) {
      this.currentTheme = detail.theme;
      this.render();
    }
  };

  constructor(private readonly el: Entity) {
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

    window.addEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
  }

  setAnalysisData(data: NodeAnalysisData): void {
    this.analysisData = data;
    this.render();
  }

  dispose(): void {
    if (this.addFlashcardFeedbackTimer !== null) {
      window.clearTimeout(this.addFlashcardFeedbackTimer);
      this.addFlashcardFeedbackTimer = null;
    }
    window.removeEventListener(ZONE_THEME_CHANGE_EVENT, this.onThemeChange);
    this.rootGroupEl.remove();
  }

  private render(): void {
    while (this.rootGroupEl.firstChild) {
      this.rootGroupEl.removeChild(this.rootGroupEl.firstChild);
    }

    if (!this.analysisData) return;
    const data = this.analysisData;
    const isLight = this.currentTheme === 'light-glass';
    const palette = getThemePalette(this.currentTheme);

    const titleColor = isLight ? '#0F172A' : '#F8FAFC';
    const bodyColor = isLight ? '#1E293B' : '#E2E8F0';
    const mutedColor = isLight ? '#475569' : '#94A3B8';
    const accentColor = '#0284C7';
    const cardBgColor = isLight ? '#F8FAFC' : '#1E293B';
    const cardBorderColor = isLight ? '#CBD5E1' : '#334155';

    // sincroniza dimensões ampliadas do imx-panel e da alça para leitura confortável no vr box
    const panel = this.el.components['imx-panel'] as PanelComponent | undefined;
    if (panel) {
      this.el.setAttribute('imx-panel', 'title', '');
      this.el.setAttribute('imx-panel', 'body', '');
      this.el.setAttribute('imx-panel', 'footer', '');
      this.el.setAttribute('imx-panel', 'width', 0.96);
      this.el.setAttribute('imx-panel', 'height', 0.76);
    }
    if (this.el.hasAttribute('imx-drag-handle')) {
      this.el.setAttribute('imx-drag-handle', { width: 0.96, height: 0.76 });
    }

    // badge superior
    const badgeEl = createTroikaText('ANÁLISE DE CONCEITO', {
      position: '-0.42 0.315 0.004',
      fontSize: 0.017,
      color: accentColor,
      align: 'left',
      anchor: 'left',
    });
    this.rootGroupEl.appendChild(badgeEl);

    // título do conceito
    const titleEl = createTroikaText(data.label, {
      position: '-0.42 0.255 0.004',
      fontSize: 0.032,
      maxWidth: 0.6,
      color: titleColor,
      align: 'left',
      anchor: 'left',
    });
    this.rootGroupEl.appendChild(titleEl);

    // botão âncora com o número da página da fonte
    const anchorBtnRoot = createSubEntity('a-entity', {
      position: '0.31 0.255 0.006',
    });
    const anchorBtnBorder = createSubEntity('a-entity', {
      geometry: 'primitive: rounded-rect; width: 0.208; height: 0.072; radius: 0.016',
      position: '0 0 -0.001',
      material: `color: ${accentColor}; shader: flat; opacity: 0.9; transparent: true`,
    });
    const anchorBtnBg = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: 'primitive: rounded-rect; width: 0.20; height: 0.064; radius: 0.014',
      material: `color: ${cardBgColor}; shader: flat; opacity: 0.98; transparent: true`,
    });
    const anchorBtnText = createTroikaText(`Pág. ${data.sourcePage}`, {
      position: '0 0 0.003',
      fontSize: 0.021,
      color: accentColor,
      align: 'center',
      anchor: 'center',
    });

    anchorBtnBg.addEventListener('mouseenter', () => {
      anchorBtnRoot.setAttribute('scale', '1.06 1.06 1');
    });
    anchorBtnBg.addEventListener('mouseleave', () => {
      anchorBtnRoot.setAttribute('scale', '1 1 1');
    });
    anchorBtnBg.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      const detail: ZoneGotoPdfPageDetail = { page: data.sourcePage };
      this.el.sceneEl?.emit(ZONE_GOTO_PDF_PAGE_EVENT, detail);
    });

    anchorBtnBg.appendChild(anchorBtnText);
    anchorBtnRoot.appendChild(anchorBtnBorder);
    anchorBtnRoot.appendChild(anchorBtnBg);
    this.rootGroupEl.appendChild(anchorBtnRoot);

    // linha divisória horizontal superior
    const dividerEl = createSubEntity('a-plane', {
      position: '0 0.195 0.004',
      width: 0.84,
      height: 0.003,
      material: `color: ${cardBorderColor}; shader: flat; opacity: 0.8; transparent: true`,
    });
    this.rootGroupEl.appendChild(dividerEl);

    // seção: definição
    const defHeaderEl = createTroikaText('DEFINIÇÃO', {
      position: '-0.42 0.16 0.004',
      fontSize: 0.016,
      color: mutedColor,
      align: 'left',
      anchor: 'left',
    });
    this.rootGroupEl.appendChild(defHeaderEl);

    const definitionEl = createTroikaText(data.definition, {
      position: '-0.42 0.13 0.004',
      fontSize: 0.023,
      maxWidth: 0.84,
      lineHeight: 1.35,
      color: bodyColor,
      align: 'left',
      anchor: 'left',
      baseline: 'top',
    });
    this.rootGroupEl.appendChild(definitionEl);

    // seção: relações estruturais (pais e filhos)
    const relHeaderEl = createTroikaText('RELAÇÕES ESTRUTURAIS', {
      position: '-0.42 -0.04 0.004',
      fontSize: 0.016,
      color: mutedColor,
      align: 'left',
      anchor: 'left',
    });
    this.rootGroupEl.appendChild(relHeaderEl);

    const relationLines: string[] = [];
    if (data.parents.length > 0) {
      for (const p of data.parents) {
        relationLines.push(`[${p.label}] -> (${p.relation}) -> [${data.label}]`);
      }
    }
    if (data.children.length > 0) {
      for (const c of data.children) {
        relationLines.push(`[${data.label}] -> (${c.relation}) -> [${c.label}]`);
      }
    }
    if (relationLines.length === 0) {
      relationLines.push('Conceito estruturalmente isolado no material extraído.');
    }

    const relBodyText = relationLines.slice(0, 3).join('\n');
    const relTextEl = createTroikaText(relBodyText, {
      position: '-0.42 -0.07 0.004',
      fontSize: 0.02,
      maxWidth: 0.84,
      lineHeight: 1.38,
      color: isLight ? '#0F172A' : '#93C5FD',
      align: 'left',
      anchor: 'left',
      baseline: 'top',
    });
    this.rootGroupEl.appendChild(relTextEl);

    // linha divisória inferior
    const bottomDividerEl = createSubEntity('a-plane', {
      position: '0 -0.225 0.004',
      width: 0.84,
      height: 0.003,
      material: `color: ${cardBorderColor}; shader: flat; opacity: 0.8; transparent: true`,
    });
    this.rootGroupEl.appendChild(bottomDividerEl);

    // botão único do rodapé: adicionar flashcard
    this.renderFooterActions(data, cardBgColor, palette.buttonTextColor);
  }

  private renderFooterActions(
    data: NodeAnalysisData,
    bgColor: string,
    textColor: string,
  ): void {
    const btnFlashcardRoot = createSubEntity('a-entity', {
      position: '0 -0.295 0.006',
    });
    const btnFlashcardBorder = createSubEntity('a-entity', {
      geometry: 'primitive: rounded-rect; width: 0.57; height: 0.084; radius: 0.018',
      position: '0 0 -0.001',
      material: 'color: #0284C7; shader: flat; opacity: 0.92; transparent: true',
    });
    const btnFlashcardBg = createSubEntity('a-entity', {
      class: 'interactable',
      geometry: 'primitive: rounded-rect; width: 0.56; height: 0.076; radius: 0.016',
      material: `color: ${bgColor}; shader: flat; opacity: 0.98; transparent: true`,
    });
    const btnFlashcardText = createTroikaText('Adicionar Flashcard', {
      position: '0 0 0.003',
      fontSize: 0.023,
      maxWidth: 0.52,
      color: textColor,
      align: 'center',
      anchor: 'center',
    });

    const updateButtonText = (label: string, color: string): void => {
      btnFlashcardText.setAttribute('value', label);
      btnFlashcardText.setAttribute('color', color);
      btnFlashcardText.setAttribute('troika-text', 'value', label);
      btnFlashcardText.setAttribute('troika-text', 'color', color);
    };

    btnFlashcardBg.addEventListener('mouseenter', () => {
      btnFlashcardRoot.setAttribute('scale', '1.05 1.05 1');
    });
    btnFlashcardBg.addEventListener('mouseleave', () => {
      btnFlashcardRoot.setAttribute('scale', '1 1 1');
    });

    btnFlashcardBg.addEventListener('click', (event: Event) => {
      event.stopPropagation();
      const card: StudyCard = {
        id: `card-${data.conceptId}-${Date.now()}`,
        title: data.label,
        body: data.definition,
        conceptIds: [data.conceptId],
        anchors: [
          {
            sourceId: 'src-pdf',
            page: data.sourcePage,
            chunkId: `chunk-${data.conceptId}`,
          },
        ],
      };
      const detail: ZoneSaveCardToDeckDetail = { card };
      this.el.sceneEl?.emit(ZONE_SAVE_CARD_TO_DECK_EVENT, detail);

      updateButtonText('Flashcard Salvo!', '#10B981');
      if (this.addFlashcardFeedbackTimer !== null) {
        window.clearTimeout(this.addFlashcardFeedbackTimer);
      }
      this.addFlashcardFeedbackTimer = window.setTimeout(() => {
        updateButtonText('Adicionar Flashcard', textColor);
        this.addFlashcardFeedbackTimer = null;
      }, 2500);
    });

    btnFlashcardBg.appendChild(btnFlashcardText);
    btnFlashcardRoot.appendChild(btnFlashcardBorder);
    btnFlashcardRoot.appendChild(btnFlashcardBg);
    this.rootGroupEl.appendChild(btnFlashcardRoot);
  }
}

AFRAME.registerComponent<NodeAnalysisPanelComponent>('imx-node-analysis-panel', {
  dependencies: ['imx-panel'],
  schema: {
    conceptId: { type: 'string', default: '' },
  },
  init() {
    this.controller = new NodeAnalysisPanelController(this.el);
  },
  remove() {
    this.controller?.dispose();
  },
});
