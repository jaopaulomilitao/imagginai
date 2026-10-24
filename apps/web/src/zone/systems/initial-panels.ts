import { PT_BR } from '../../shared/i18n/pt-br';
import type { StudyCard, StudyPack } from '../../shared/types/study-pack';
import type { PanelLayout } from '../../shared/types/zone';
import {
  DEFAULT_PANEL_RADIUS_M,
  PANEL_DEFAULT_HEIGHT_M,
  PANEL_DEFAULT_WIDTH_M,
} from '../config/constants';
import { normalizeYawDeg } from './belt-controller';
import { resolvePanelPlacement } from './spherical';

export type InitialPanelKind = 'card-panel' | 'pdf-panel';

export const WELCOME_PLACEHOLDER_PANEL_ID = 'panel-welcome-placeholder';

export interface InitialZonePanelSpec {
  readonly panelId: string;
  readonly kind: InitialPanelKind;
  readonly defaultLayout: PanelLayout;
  readonly card?: StudyCard;
  readonly sourceTitle?: string;
  readonly pageCount?: number;
  readonly width?: number;
  readonly height?: number;
  readonly opacityScale?: number;
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

// constrói o painel único central menor e de baixa opacidade exibido ao entrar na zona vr vazia (seção 4.1)
export function buildWelcomePlaceholderSpec(sourceId = 'src-default'): InitialZonePanelSpec {
  return {
    panelId: WELCOME_PLACEHOLDER_PANEL_ID,
    kind: 'card-panel',
    defaultLayout: {
      panelId: WELCOME_PLACEHOLDER_PANEL_ID,
      yawDeg: 0,
      pitchDeg: 0,
      radiusM: DEFAULT_PANEL_RADIUS_M,
    },
    width: 0.56,
    height: 0.3,
    opacityScale: 0.62,
    card: {
      id: WELCOME_PLACEHOLDER_PANEL_ID,
      title: PT_BR.zone.panels.welcomePlaceholderTitle,
      body: PT_BR.zone.panels.welcomePlaceholderBody,
      conceptIds: [],
      anchors: [{ sourceId, page: 1, chunkId: 'welcome-placeholder' }],
    },
  };
}

// calcula dinamicamente uma posição espacial livre em arco para novos painéis sem cobrir painéis já existentes (seção 4.3)
export function computeCollisionFreeSpawnPlacement(
  existingLayouts: readonly PanelLayout[],
  centerYawDeg = 0,
  panelId = `panel-spawn-${Date.now()}`,
  widthM = PANEL_DEFAULT_WIDTH_M,
  heightM = PANEL_DEFAULT_HEIGHT_M,
): PanelLayout {
  const candidateOffsets: readonly { yawOffset: number; pitch: number }[] = [
    { yawOffset: 0, pitch: 0 },
    { yawOffset: -40, pitch: 0 },
    { yawOffset: 40, pitch: 0 },
    { yawOffset: -80, pitch: 0 },
    { yawOffset: 80, pitch: 0 },
    { yawOffset: 0, pitch: 25 },
    { yawOffset: -40, pitch: 25 },
    { yawOffset: 40, pitch: 25 },
  ];

  const firstFreeCandidate = candidateOffsets[existingLayouts.length % candidateOffsets.length] ?? {
    yawOffset: 0,
    pitch: 0,
  };
  const desiredYaw = normalizeYawDeg(centerYawDeg + firstFreeCandidate.yawOffset);
  const resolved = resolvePanelPlacement(
    {
      yawDeg: desiredYaw,
      pitchDeg: firstFreeCandidate.pitch,
      radiusM: DEFAULT_PANEL_RADIUS_M,
    },
    existingLayouts,
    panelId,
    widthM,
    heightM,
  );

  return {
    panelId,
    yawDeg: resolved.yawDeg,
    pitchDeg: resolved.pitchDeg,
    radiusM: resolved.radiusM,
  };
}

export function buildPlaceholderStudyCard(slotNumber: 1 | 2, sourceId = 'src-default'): StudyCard {
  return {
    id: `placeholder-slot-${slotNumber}`,
    title: PT_BR.zone.panels.welcomePlaceholderTitle,
    body: PT_BR.zone.panels.welcomePlaceholderBody,
    conceptIds: [],
    anchors: [{ sourceId, page: 1, chunkId: `placeholder-${slotNumber}` }],
  };
}

// mantido para compatibilidade com testes de layout em arco de 3 painéis (fase 4)
export function buildInitialZonePanels(pack: StudyPack): InitialZonePanelSpec[] {
  const primarySource = pack.sources[0] ?? {
    id: 'src-default',
    title: 'Material de estudo',
    pageCount: 1,
  };

  return [
    {
      panelId: 'panel-card-1',
      kind: 'card-panel',
      defaultLayout: DEFAULT_INITIAL_PANEL_LAYOUTS[0],
      card: buildPlaceholderStudyCard(1, primarySource.id),
    },
    {
      panelId: 'panel-pdf-1',
      kind: 'pdf-panel',
      defaultLayout: DEFAULT_INITIAL_PANEL_LAYOUTS[1],
      sourceTitle: primarySource.title,
      pageCount: primarySource.pageCount,
    },
    {
      panelId: 'panel-card-2',
      kind: 'card-panel',
      defaultLayout: DEFAULT_INITIAL_PANEL_LAYOUTS[2],
      card: buildPlaceholderStudyCard(2, primarySource.id),
    },
  ];
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

// extrai o conteúdo textual por página do study pack quando não há binário de pdf externo
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
