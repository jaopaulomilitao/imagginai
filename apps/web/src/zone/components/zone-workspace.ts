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
import type { PanelComponent } from './imx-panel';
import type { PdfPanelComponent } from './imx-pdf-panel';
import {
  buildDemoPdfPageContent,
  buildWelcomePlaceholderSpec,
  computeCollisionFreeSpawnPlacement,
  DEFAULT_INITIAL_PANEL_LAYOUTS,
  WELCOME_PLACEHOLDER_PANEL_ID,
  type InitialZonePanelSpec,
} from '../systems/initial-panels';
import { recenterPanelLayouts } from '../systems/recenter-layout';

export const ZONE_RECENTER_REQUEST_EVENT = 'imx-recenter-request';
export const ZONE_SWITCH_REQUEST_EVENT = 'imx-switch-zone-request';
export const ZONE_ADD_CONTENT_REQUEST_EVENT = 'imx-add-content-request';
export const ZONE_ACTIVE_CONTENTS_CHANGE_EVENT = 'imx-active-contents-change';

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

export interface ActiveContentsChangeDetail {
  readonly activeContentIds: readonly string[];
}

export class ZoneWorkspaceController {
  private currentZoneId: string;
  private activePdfBlobUrl: string | null = null;
  private cachedPack: StudyPack | null = null;
  private cachedPdfRecord: StoredPdfFile | null = null;
  private readonly activeContentIds = new Set<string>();
  private spawnCounter = 0;

  private readonly onPanelDrop = (event: Event): void => {
    const updated = (event as CustomEvent<PanelLayout>).detail;
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

  constructor(
    private readonly scene: Scene,
    private readonly containerEl: Entity,
    zoneId: string,
    private readonly storage: LayoutRepository = zoneStorage,
  ) {
    this.currentZoneId = zoneId;
    this.scene.addEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
    this.scene.addEventListener(PANEL_DELETE_EVENT, this.onPanelDelete);
    this.scene.addEventListener(ZONE_RECENTER_REQUEST_EVENT, this.onRecenterRequest);
    this.scene.addEventListener(ZONE_SWITCH_REQUEST_EVENT, this.onSwitchZoneRequest);
    this.scene.addEventListener(ZONE_ADD_CONTENT_REQUEST_EVENT, this.onAddContentRequest);
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
    await this.init();
  }

  dispose(): void {
    this.revokePdfBlobUrl();
    this.scene.removeEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
    this.scene.removeEventListener(PANEL_DELETE_EVENT, this.onPanelDelete);
    this.scene.removeEventListener(ZONE_RECENTER_REQUEST_EVENT, this.onRecenterRequest);
    this.scene.removeEventListener(ZONE_SWITCH_REQUEST_EVENT, this.onSwitchZoneRequest);
    this.scene.removeEventListener(ZONE_ADD_CONTENT_REQUEST_EVENT, this.onAddContentRequest);
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
      if (this.cachedPdfRecord && typeof URL.createObjectURL === 'function') {
        if (!this.activePdfBlobUrl) {
          const bytes = new Uint8Array(this.cachedPdfRecord.data);
          this.activePdfBlobUrl = URL.createObjectURL(
            new Blob([bytes], { type: 'application/pdf' }),
          );
        }
        pdfUrl = this.activePdfBlobUrl;
      }
      const pageCount = detail.pageCount ?? pack?.sources[0]?.pageCount ?? 4;
      el.setAttribute('imx-pdf-panel', {
        pdfUrl,
        sourceTitle: this.cachedPdfRecord?.title ?? sourceTitle,
        page: 1,
        pageCount,
      });

      if (!this.cachedPdfRecord && pack) {
        const attachSynthetic = (): void => {
          const pdfComp = el.components['imx-pdf-panel'] as PdfPanelComponent | undefined;
          pdfComp?.controller?.setSyntheticPageProvider((pageNumber) =>
            buildDemoPdfPageContent(pack, pageNumber),
          );
        };
        if (el.hasLoaded) {
          attachSynthetic();
        } else {
          el.addEventListener('loaded', attachSynthetic, { once: true });
        }
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
