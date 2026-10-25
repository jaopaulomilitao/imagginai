import type { Entity, Scene } from 'aframe';

import demoPackRaw from '../../../../../fixtures/demo-pack.json';
import { logger } from '../../shared/logger';
import {
  resolveBundledDemoPack,
  zoneStorage,
  type LayoutRepository,
  type StoredPdfFile,
} from '../../shared/storage/dexie-db';
import type { StudyCard, StudyPack } from '../../shared/types/study-pack';
import type { PanelLayout } from '../../shared/types/zone';
import { validateStudyPack } from '../../shared/validation/study-pack-validator';
import { PANEL_DELETE_EVENT, PANEL_DROP_EVENT, type PanelDeleteDetail } from './imx-drag-handle';
import {
  CONCEPT_GRAPH_NODE_SELECT_EVENT,
  type ConceptGraphComponent,
  type ConceptGraphNodeSelectDetail,
} from './imx-concept-graph';
import type { PanelComponent } from './imx-panel';
import type { PdfPanelComponent } from './imx-pdf-panel';
import {
  QUIZ_ANSWER_EVENT,
  type QuizAnswerEventDetail,
  type QuizPanelComponent,
} from './imx-quiz-panel';
import {
  SEQUENCE_ASSET_CHECK_EVENT,
  type SequenceAssetCheckDetail,
  type SequenceAssetComponent,
} from './imx-sequence-asset';
import {
  buildDemoPdfPageContent,
  buildWelcomePlaceholderSpec,
  computeCollisionFreeSpawnPlacement,
  DEFAULT_INITIAL_PANEL_LAYOUTS,
  WELCOME_PLACEHOLDER_PANEL_ID,
  type InitialZonePanelSpec,
} from '../systems/initial-panels';
import { selectPomodoroQuizItems } from '../systems/learning-assets-controller';
import { recenterPanelLayouts } from '../systems/recenter-layout';
import { SessionTelemetryCollector } from '../systems/session-telemetry-collector';

export const ZONE_RECENTER_REQUEST_EVENT = 'imx-recenter-request';
export const ZONE_SWITCH_REQUEST_EVENT = 'imx-switch-zone-request';
export const ZONE_ADD_CONTENT_REQUEST_EVENT = 'imx-add-content-request';
export const ZONE_ACTIVE_CONTENTS_CHANGE_EVENT = 'imx-active-contents-change';
export const ZONE_POMODORO_QUIZ_REQUEST_EVENT = 'imx-pomodoro-quiz-request';
export const ZONE_EXIT_FINALIZE_EVENT = 'imx-exit-finalize-request';

export type SpawnableContentKind = 'pdf' | 'flashcard' | 'quiz' | 'study-object';

export interface RecenterRequestDetail {
  readonly cameraYawDeg: number;
}

export interface SwitchZoneRequestDetail {
  readonly zoneId: string;
}

export interface AddContentRequestDetail {
  readonly contentId?: string;
  readonly kind?: SpawnableContentKind;
  readonly card: StudyCard;
  readonly sourceTitle?: string;
  readonly pageCount?: number;
  readonly accentColor?: string;
  readonly cameraYawDeg?: number;
}

export interface PomodoroQuizRequestDetail {
  readonly cameraYawDeg: number;
  readonly completedBlocks: number;
}

export interface ActiveContentsChangeDetail {
  readonly activeContentIds: readonly string[];
}

export class ZoneWorkspaceController {
  readonly telemetry: SessionTelemetryCollector;
  private currentZoneId: string;
  private activePdfBlobUrl: string | null = null;
  private cachedPack: StudyPack | null = null;
  private cachedPdfRecord: StoredPdfFile | null = null;
  private readonly activeContentIds = new Set<string>();
  private spawnCounter = 0;

  private readonly onPanelDrop = (event: Event): void => {
    const updated = (event as CustomEvent<PanelLayout>).detail;
    this.telemetry.record('panel.move', {
      panelId: updated.panelId,
      yawDeg: updated.yawDeg,
      pitchDeg: updated.pitchDeg,
      radiusM: updated.radiusM,
    });
    void this.storage
      .upsertPanelLayout(this.currentZoneId, updated, DEFAULT_INITIAL_PANEL_LAYOUTS)
      .catch((error: unknown) => {
        logger.error('failed to persist panel layout on drop', error);
      });
  };

  private readonly onPanelDelete = (event: Event): void => {
    const detail = (event as CustomEvent<PanelDeleteDetail>).detail;
    if (!detail) return;
    if (detail.contentId) {
      this.activeContentIds.delete(detail.contentId);
    }
    this.activeContentIds.delete(detail.panelId);
    this.emitActiveContentsChange();
  };

  private readonly onRecenterRequest = (event: Event): void => {
    const detail = (event as CustomEvent<RecenterRequestDetail>).detail;
    void this.recenter(detail?.cameraYawDeg ?? 0).catch((error: unknown) => {
      logger.error('failed to recenter zone panels', error);
    });
  };

  private readonly onSwitchZoneRequest = (event: Event): void => {
    const detail = (event as CustomEvent<SwitchZoneRequestDetail>).detail;
    if (!detail?.zoneId) return;
    void this.switchZone(detail.zoneId).catch((error: unknown) => {
      logger.error('failed to switch zone workspace', error);
    });
  };

  private readonly onAddContentRequest = (event: Event): void => {
    const detail = (event as CustomEvent<AddContentRequestDetail>).detail;
    if (!detail?.card) return;
    this.spawnContentInScene(detail);
  };

  private readonly onConceptGraphSelect = (event: Event): void => {
    const detail = (event as CustomEvent<ConceptGraphNodeSelectDetail>).detail;
    if (!detail) return;
    this.telemetry.record('concept.open', {
      conceptId: detail.conceptId,
      source: 'concept-graph',
    });
    this.telemetry.record('concept.focus', {
      conceptId: detail.conceptId,
      durationMs: 6500,
    });
    this.spawnContentInScene({
      contentId: `concept-${detail.conceptId}`,
      kind: 'flashcard',
      card: detail.card,
      sourceTitle: detail.sourceTitle,
      accentColor: '#1E3A8A',
    });
  };

  private readonly onQuizAnswer = (event: Event): void => {
    const detail = (event as CustomEvent<QuizAnswerEventDetail>).detail;
    if (!detail) return;
    const primaryConceptId = detail.conceptIds[0] ?? detail.questionId;
    this.telemetry.record('quiz.answer', {
      questionId: detail.questionId,
      conceptId: primaryConceptId,
      correct: detail.isCorrect,
    });
    if (this.cachedPack) {
      const q = this.cachedPack.quiz.find((item) => item.id === detail.questionId);
      if (q) {
        q.answered = true;
        void this.storage.saveStudyPack?.(this.currentZoneId, this.cachedPack);
      }
    }
  };

  private readonly onSequenceCheck = (event: Event): void => {
    const detail = (event as CustomEvent<SequenceAssetCheckDetail>).detail;
    if (!detail) return;
    this.telemetry.record('asset.sequence.check', {
      assetId: detail.assetId,
      correct: detail.isCorrect,
      attempts: detail.attempts,
    });
  };

  private readonly onPomodoroQuizRequest = (event: Event): void => {
    const detail = (event as CustomEvent<PomodoroQuizRequestDetail>).detail;
    this.telemetry.record('pomodoro.block.end', {
      completedBlocks: detail?.completedBlocks ?? 1,
    });
    this.spawnPomodoroQuizPanel(detail?.cameraYawDeg ?? 0);
  };

  private readonly onExitFinalize = (event: Event): void => {
    const detail = (event as CustomEvent<{ completedBlocks?: number }>).detail;
    void this.telemetry.finalizeSession(detail?.completedBlocks ?? 0).catch((error: unknown) => {
      logger.error('failed to finalize session telemetry on zone exit', error);
    });
  };

  constructor(
    private readonly scene: Scene,
    private readonly containerEl: Entity,
    zoneId: string,
    private readonly storage: LayoutRepository = zoneStorage,
    telemetryCollector?: SessionTelemetryCollector,
  ) {
    this.currentZoneId = zoneId;
    this.telemetry = telemetryCollector ?? new SessionTelemetryCollector(zoneId, storage);
    this.scene.addEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
    this.scene.addEventListener(PANEL_DELETE_EVENT, this.onPanelDelete);
    this.scene.addEventListener(ZONE_RECENTER_REQUEST_EVENT, this.onRecenterRequest);
    this.scene.addEventListener(ZONE_SWITCH_REQUEST_EVENT, this.onSwitchZoneRequest);
    this.scene.addEventListener(ZONE_ADD_CONTENT_REQUEST_EVENT, this.onAddContentRequest);
    this.scene.addEventListener(CONCEPT_GRAPH_NODE_SELECT_EVENT, this.onConceptGraphSelect);
    this.scene.addEventListener(QUIZ_ANSWER_EVENT, this.onQuizAnswer);
    this.scene.addEventListener(SEQUENCE_ASSET_CHECK_EVENT, this.onSequenceCheck);
    this.scene.addEventListener(ZONE_POMODORO_QUIZ_REQUEST_EVENT, this.onPomodoroQuizRequest);
    this.scene.addEventListener(ZONE_EXIT_FINALIZE_EVENT, this.onExitFinalize);
  }

  getZoneId(): string {
    return this.currentZoneId;
  }

  getActiveContentIds(): string[] {
    return [...this.activeContentIds];
  }

  async init(): Promise<void> {
    this.clearSpawnedPanels();
    this.activeContentIds.clear();
    this.emitActiveContentsChange();
    await this.telemetry.initConsent();

    const pack = await this.loadZonePack();
    this.cachedPack = pack;
    this.cachedPdfRecord = (await this.storage.loadPdfFile?.(this.currentZoneId)) ?? null;

    // ao entrar na zona vr, renderiza apenas o painel placeholder único centralizado de baixa opacidade (seção 4.1)
    const primarySourceId = pack.sources[0]?.id ?? 'src-default';
    const welcomeSpec = buildWelcomePlaceholderSpec(primarySourceId);
    this.spawnWelcomePlaceholder(welcomeSpec);
  }

  async recenter(cameraYawDeg: number): Promise<PanelLayout[]> {
    const current = this.collectCurrentLayouts();
    if (current.length === 0) return [];
    const nextLayouts = recenterPanelLayouts(current, cameraYawDeg);

    for (const placement of nextLayouts) {
      const panelEl = this.containerEl.querySelector<Entity>(`#${placement.panelId}`);
      if (!panelEl) continue;
      panelEl.setAttribute('imx-panel', {
        panelId: placement.panelId,
        yawDeg: placement.yawDeg,
        pitchDeg: placement.pitchDeg,
        radiusM: placement.radiusM,
      });
    }

    await this.storage.saveLayout(this.currentZoneId, nextLayouts);
    return nextLayouts;
  }

  async switchZone(nextZoneId: string): Promise<void> {
    this.currentZoneId = nextZoneId;
    this.telemetry.setZoneId(nextZoneId);
    await this.init();
  }

  dispose(): void {
    this.revokePdfBlobUrl();
    this.scene.removeEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
    this.scene.removeEventListener(PANEL_DELETE_EVENT, this.onPanelDelete);
    this.scene.removeEventListener(ZONE_RECENTER_REQUEST_EVENT, this.onRecenterRequest);
    this.scene.removeEventListener(ZONE_SWITCH_REQUEST_EVENT, this.onSwitchZoneRequest);
    this.scene.removeEventListener(ZONE_ADD_CONTENT_REQUEST_EVENT, this.onAddContentRequest);
    this.scene.removeEventListener(CONCEPT_GRAPH_NODE_SELECT_EVENT, this.onConceptGraphSelect);
    this.scene.removeEventListener(QUIZ_ANSWER_EVENT, this.onQuizAnswer);
    this.scene.removeEventListener(SEQUENCE_ASSET_CHECK_EVENT, this.onSequenceCheck);
    this.scene.removeEventListener(ZONE_POMODORO_QUIZ_REQUEST_EVENT, this.onPomodoroQuizRequest);
    this.scene.removeEventListener(ZONE_EXIT_FINALIZE_EVENT, this.onExitFinalize);
    this.telemetry.dispose();
  }

  // cria um painel de quiz ao final do bloco pomodoro com 3 a 5 questões dos conceitos menos visualizados
  spawnPomodoroQuizPanel(cameraYawDeg = 0): void {
    const pack = this.cachedPack;
    if (!pack || pack.quiz.length === 0) return;

    const unanswered = pack.quiz.filter((q) => !q.answered);
    const quizPool = unanswered.length > 0 ? unanswered : pack.quiz;
    const selectedItems = selectPomodoroQuizItems(quizPool, this.telemetry.getConceptOpens(), 4);
    const contentId = 'pomodoro-block-quiz';
    if (this.activeContentIds.has(contentId)) {
      return;
    }

    this.fadeOutWelcomePlaceholder();
    this.spawnCounter += 1;
    const panelId = `panel-item-${this.spawnCounter}`;
    const existingLayouts = this.collectCurrentLayouts().filter(
      (item) => item.panelId !== WELCOME_PLACEHOLDER_PANEL_ID,
    );
    const placement = computeCollisionFreeSpawnPlacement(existingLayouts, cameraYawDeg, panelId);

    const el = document.createElement('a-entity') as Entity;
    el.id = panelId;
    el.setAttribute('data-content-id', contentId);
    el.setAttribute('imx-panel', {
      panelId,
      yawDeg: placement.yawDeg,
      pitchDeg: placement.pitchDeg,
      radiusM: placement.radiusM,
      accentColor: '#EA580C',
    });

    const sourceTitle = pack.sources[0]?.title ?? 'Material de estudo';
    el.setAttribute('imx-quiz-panel', {
      quizId: contentId,
      sourceTitle,
    });
    const attachQuiz = (): void => {
      const comp = el.components['imx-quiz-panel'] as QuizPanelComponent | undefined;
      comp?.controller?.setQuestions(selectedItems);
    };
    if (el.hasLoaded) {
      attachQuiz();
    } else {
      el.addEventListener('loaded', attachQuiz, { once: true });
    }

    el.setAttribute('imx-drag-handle', {
      cameraSelector: '#main-camera',
      contentId,
    });

    this.containerEl.appendChild(el);
    this.activeContentIds.add(contentId);
    this.emitActiveContentsChange();
  }

  // adiciona um item do menu conteúdos à cena em posição livre sem sobreposição e remove o placeholder inicial (seções 4.1 e 4.3)
  spawnContentInScene(detail: AddContentRequestDetail): void {
    const contentId = detail.contentId ?? detail.card.id;
    if (this.activeContentIds.has(contentId)) {
      return;
    }

    this.fadeOutWelcomePlaceholder();

    this.spawnCounter += 1;
    const panelId = `panel-item-${this.spawnCounter}`;
    const existingLayouts = this.collectCurrentLayouts().filter(
      (item) => item.panelId !== WELCOME_PLACEHOLDER_PANEL_ID,
    );
    const placement = computeCollisionFreeSpawnPlacement(
      existingLayouts,
      detail.cameraYawDeg ?? 0,
      panelId,
    );

    const el = document.createElement('a-entity') as Entity;
    el.id = panelId;
    el.setAttribute('data-content-id', contentId);

    el.setAttribute('imx-panel', {
      panelId,
      yawDeg: placement.yawDeg,
      pitchDeg: placement.pitchDeg,
      radiusM: placement.radiusM,
      accentColor: detail.accentColor ?? '#0284C7',
    });

    const pack = this.cachedPack;
    const sourceTitle = detail.sourceTitle ?? pack?.sources[0]?.title ?? 'Material de estudo';

    if (detail.kind === 'pdf') {
      let pdfUrl = '';
      let pdfBytes: Uint8Array | null = null;
      if (this.cachedPdfRecord) {
        pdfBytes = new Uint8Array(this.cachedPdfRecord.data);
        if (typeof URL.createObjectURL === 'function') {
          if (!this.activePdfBlobUrl) {
            this.activePdfBlobUrl = URL.createObjectURL(
              new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' }),
            );
          }
          pdfUrl = this.activePdfBlobUrl;
        }
      }
      const pageCount = detail.pageCount ?? pack?.sources[0]?.pageCount ?? 4;
      el.setAttribute('imx-pdf-panel', {
        pdfUrl,
        sourceTitle: this.cachedPdfRecord?.title ?? sourceTitle,
        page: 1,
        pageCount,
      });

      const attachPdfData = (): void => {
        const pdfComp = el.components['imx-pdf-panel'] as PdfPanelComponent | undefined;
        if (pdfBytes) {
          pdfComp?.controller?.setPdfBytes(pdfBytes);
        } else if (pack) {
          pdfComp?.controller?.setSyntheticPageProvider((pageNumber) =>
            buildDemoPdfPageContent(pack, pageNumber),
          );
        }
      };
      if (el.hasLoaded) {
        attachPdfData();
      } else {
        el.addEventListener('loaded', attachPdfData, { once: true });
      }
    } else if (detail.kind === 'quiz' && pack && pack.quiz.length > 0) {
      const rawQuizId = contentId.replace(/^quiz-/, '');
      const matchingQuestion = pack.quiz.find((q) => q.id === rawQuizId);
      const activeUnanswered = pack.quiz.filter((q) => !q.answered);
      const questionsToLoad = matchingQuestion
        ? [matchingQuestion]
        : activeUnanswered.length > 0
          ? activeUnanswered
          : pack.quiz;

      el.setAttribute('imx-quiz-panel', {
        quizId: contentId,
        sourceTitle,
      });
      const attachQuiz = (): void => {
        const comp = el.components['imx-quiz-panel'] as QuizPanelComponent | undefined;
        comp?.controller?.setQuestions(questionsToLoad);
      };
      if (el.hasLoaded) {
        attachQuiz();
      } else {
        el.addEventListener('loaded', attachQuiz, { once: true });
      }
    } else if (detail.kind === 'study-object' && pack) {
      const rawAssetId = contentId.replace(/^asset-/, '');
      const asset = pack.assets.find((a) => a.id === rawAssetId) ?? pack.assets[0];
      if (asset?.kind === 'concept-graph') {
        el.setAttribute('imx-concept-graph', {
          assetId: asset.id,
          sourceTitle,
        });
        const attachGraph = (): void => {
          const comp = el.components['imx-concept-graph'] as ConceptGraphComponent | undefined;
          comp?.controller?.setGraphData(asset, pack.concepts, pack.edges);
        };
        if (el.hasLoaded) {
          attachGraph();
        } else {
          el.addEventListener('loaded', attachGraph, { once: true });
        }
      } else if (asset?.kind === 'sequence-order') {
        el.setAttribute('imx-sequence-asset', {
          assetId: asset.id,
          sourceTitle,
        });
        const attachSequence = (): void => {
          const comp = el.components['imx-sequence-asset'] as SequenceAssetComponent | undefined;
          comp?.controller?.setSequenceAsset(asset);
        };
        if (el.hasLoaded) {
          attachSequence();
        } else {
          el.addEventListener('loaded', attachSequence, { once: true });
        }
      } else {
        const sourcePage = detail.card.anchors[0]?.page ?? 1;
        el.setAttribute('imx-card-panel', {
          cardId: detail.card.id,
          title: detail.card.title,
          body: detail.card.body,
          sourcePage,
          sourceTitle,
          accentColor: detail.accentColor ?? '#0284C7',
        });
      }
    } else {
      const sourcePage = detail.card.anchors[0]?.page ?? 1;
      el.setAttribute('imx-card-panel', {
        cardId: detail.card.id,
        title: detail.card.title,
        body: detail.card.body,
        sourcePage,
        sourceTitle,
        accentColor: detail.accentColor ?? '#0284C7',
      });
    }

    el.setAttribute('imx-drag-handle', {
      cameraSelector: '#main-camera',
      contentId,
    });

    this.containerEl.appendChild(el);
    this.activeContentIds.add(contentId);
    this.emitActiveContentsChange();

    this.telemetry.record('panel.open', {
      panelId,
      contentId,
      kind: detail.kind ?? 'flashcard',
    });

    for (const conceptId of detail.card.conceptIds) {
      this.telemetry.record('concept.open', { conceptId });
      this.telemetry.record('concept.focus', { conceptId, durationMs: 8000 });
    }
  }

  assignCardToSlot(card: StudyCard, sourceTitle = 'Material de estudo'): void {
    this.spawnContentInScene({
      contentId: card.id,
      kind: 'flashcard',
      card,
      sourceTitle,
    });
  }

  private spawnWelcomePlaceholder(spec: InitialZonePanelSpec): void {
    const el = document.createElement('a-entity') as Entity;
    el.id = spec.panelId;

    el.setAttribute('imx-panel', {
      panelId: spec.panelId,
      title: spec.card?.title ?? '',
      body: spec.card?.body ?? '',
      footer: '',
      width: spec.width ?? 0.56,
      height: spec.height ?? 0.3,
      yawDeg: spec.defaultLayout.yawDeg,
      pitchDeg: spec.defaultLayout.pitchDeg,
      radiusM: spec.defaultLayout.radiusM,
      opacityScale: spec.opacityScale ?? 0.62,
    });

    this.containerEl.appendChild(el);
  }

  private fadeOutWelcomePlaceholder(): void {
    const placeholderEl = this.containerEl.querySelector<Entity>(
      `#${WELCOME_PLACEHOLDER_PANEL_ID}`,
    );
    if (!placeholderEl) return;
    const comp = placeholderEl.components['imx-panel'] as PanelComponent | undefined;
    if (comp?.controller) {
      comp.controller.fadeOutAndRemove(240);
    } else {
      placeholderEl.remove();
    }
  }

  private emitActiveContentsChange(): void {
    const detail: ActiveContentsChangeDetail = {
      activeContentIds: [...this.activeContentIds],
    };
    this.scene.emit(ZONE_ACTIVE_CONTENTS_CHANGE_EVENT, detail);
  }

  private revokePdfBlobUrl(): void {
    if (this.activePdfBlobUrl && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this.activePdfBlobUrl);
      this.activePdfBlobUrl = null;
    }
  }

  private collectCurrentLayouts(): PanelLayout[] {
    const nodes = this.containerEl.querySelectorAll('[imx-panel]');
    const layouts: PanelLayout[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i] as Entity | undefined;
      const comp = el?.components['imx-panel'] as PanelComponent | undefined;
      if (comp?.controller) {
        const { yawDeg, pitchDeg, radiusM } = comp.controller.spherical;
        layouts.push({
          panelId: comp.controller.panelId,
          yawDeg,
          pitchDeg,
          radiusM,
        });
      }
    }
    return layouts;
  }

  private clearSpawnedPanels(): void {
    this.revokePdfBlobUrl();
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild);
    }
  }

  private async loadZonePack(): Promise<StudyPack> {
    if (this.storage.loadStudyPack) {
      const stored = await this.storage.loadStudyPack(this.currentZoneId);
      if (stored) {
        const validated = validateStudyPack(stored);
        if (validated.ok) return validated.pack;
      }
    }
    const bundled = resolveBundledDemoPack(this.currentZoneId);
    if (bundled) return bundled;

    const fallback = validateStudyPack(demoPackRaw);
    if (!fallback.ok) {
      throw new Error(`invalid demo pack: ${fallback.errors.join('; ')}`);
    }
    return fallback.pack;
  }
}
