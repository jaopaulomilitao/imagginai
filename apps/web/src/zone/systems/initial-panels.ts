import type { StudyCard, StudyPack } from '../../shared/types/study-pack';
import type { PanelLayout } from '../../shared/types/zone';
import { DEFAULT_PANEL_RADIUS_M } from '../config/constants';

export type InitialPanelKind = 'card-panel' | 'pdf-panel';

export interface InitialZonePanelSpec {
  readonly panelId: string;
  readonly kind: InitialPanelKind;
  readonly defaultLayout: PanelLayout;
  readonly card?: StudyCard;
  readonly sourceTitle?: string;
  readonly pageCount?: number;
}

export const DEFAULT_INITIAL_PANEL_LAYOUTS: readonly [PanelLayout, PanelLayout, PanelLayout] = [
  { panelId: 'panel-card-1', yawDeg: -40, pitchDeg: 0, radiusM: DEFAULT_PANEL_RADIUS_M },
  { panelId: 'panel-pdf-1', yawDeg: 0, pitchDeg: 0, radiusM: DEFAULT_PANEL_RADIUS_M },
  { panelId: 'panel-card-2', yawDeg: 40, pitchDeg: 0, radiusM: DEFAULT_PANEL_RADIUS_M },
];

export interface SyntheticPdfPageContent {
  readonly pageNumber: number;
  readonly pageCount: number;
  readonly sourceTitle: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

// constrói a especificação dos 3 painéis iniciais da zona a partir do study pack (fase 4)
export function buildInitialZonePanels(pack: StudyPack): InitialZonePanelSpec[] {
  const firstCard = pack.cards[0];
  const secondCard = pack.cards[1] ?? pack.cards[0];
  const primarySource = pack.sources[0] ?? {
    id: 'src-default',
    title: 'Material de estudo',
    pageCount: 1,
  };

  const specs: InitialZonePanelSpec[] = [];
  if (firstCard) {
    specs.push({
      panelId: 'panel-card-1',
      kind: 'card-panel',
      defaultLayout: DEFAULT_INITIAL_PANEL_LAYOUTS[0],
      card: firstCard,
    });
  }
  specs.push({
    panelId: 'panel-pdf-1',
    kind: 'pdf-panel',
    defaultLayout: DEFAULT_INITIAL_PANEL_LAYOUTS[1],
    sourceTitle: primarySource.title,
    pageCount: primarySource.pageCount,
  });
  if (secondCard) {
    specs.push({
      panelId: 'panel-card-2',
      kind: 'card-panel',
      defaultLayout: DEFAULT_INITIAL_PANEL_LAYOUTS[2],
      card: secondCard,
    });
  }
  return specs;
}

// mescla o layout salvo no dexie com as posições padrão dos painéis iniciais
export function resolveInitialPanelLayouts(
  savedLayout: readonly PanelLayout[] | null,
  defaults: readonly PanelLayout[] = DEFAULT_INITIAL_PANEL_LAYOUTS,
): PanelLayout[] {
  if (!savedLayout || savedLayout.length === 0) {
    return defaults.map((item) => ({ ...item }));
  }
  const byId = new Map(savedLayout.map((item) => [item.panelId, item]));
  return defaults.map((fallback) => {
    const found = byId.get(fallback.panelId);
    return found ? { ...found } : { ...fallback };
  });
}

// extrai o conteúdo textual por página do demo pack para renderizar a página de pdf offline quando não há binário externo
export function buildDemoPdfPageContent(
  pack: StudyPack,
  pageNumber: number,
): SyntheticPdfPageContent {
  const source = pack.sources[0] ?? {
    id: 'src-default',
    title: 'Material de estudo',
    pageCount: 1,
  };
  const pageConcepts = pack.concepts.filter((concept) =>
    concept.anchors.some((anchor) => anchor.page === pageNumber),
  );
  const pageCards = pack.cards.filter((card) =>
    card.anchors.some((anchor) => anchor.page === pageNumber),
  );

  const heading = pageCards[0]?.title ?? `Seção ${pageNumber}`;
  const paragraphs: string[] = [];

  for (const card of pageCards) {
    paragraphs.push(card.body);
  }
  for (const concept of pageConcepts) {
    paragraphs.push(`${concept.label}: ${concept.definition}`);
  }
  if (paragraphs.length === 0) {
    paragraphs.push(source.title);
  }

  return {
    pageNumber,
    pageCount: source.pageCount,
    sourceTitle: source.title,
    heading,
    paragraphs,
  };
}
