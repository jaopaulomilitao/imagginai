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
import { PANEL_DROP_EVENT } from './imx-drag-handle';
import type { PanelComponent } from './imx-panel';
import type { PdfPanelComponent } from './imx-pdf-panel';
import {
  buildDemoPdfPageContent,
  buildInitialZonePanels,
  DEFAULT_INITIAL_PANEL_LAYOUTS,
  resolveInitialPanelLayouts,
  type InitialZonePanelSpec,
} from '../systems/initial-panels';
import { recenterPanelLayouts } from '../systems/recenter-layout';

export const ZONE_RECENTER_REQUEST_EVENT = 'imx-recenter-request';
export const ZONE_SWITCH_REQUEST_EVENT = 'imx-switch-zone-request';
export const ZONE_ADD_CONTENT_REQUEST_EVENT = 'imx-add-content-request';

export interface RecenterRequestDetail {
  readonly cameraYawDeg: number;
}

export interface SwitchZoneRequestDetail {
  readonly zoneId: string;
}

export interface AddContentRequestDetail {
  readonly card: StudyCard;
  readonly sourceTitle?: string;
}

export class ZoneWorkspaceController {
  private currentZoneId: string;
  private activePdfBlobUrl: string | null = null;
  private nextCardSlotIndex = 0;

  private readonly onPanelDrop = (event: Event): void => {
    const updated = (event as CustomEvent<PanelLayout>).detail;
    void this.storage
      .upsertPanelLayout(this.currentZoneId, updated, DEFAULT_INITIAL_PANEL_LAYOUTS)
      .catch((error: unknown) => {
        logger.error('failed to persist panel layout on drop', error);
      });
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
    this.assignCardToSlot(detail.card, detail.sourceTitle);
  };

  constructor(
    private readonly scene: Scene,
    private readonly containerEl: Entity,
    zoneId: string,
    private readonly storage: LayoutRepository = zoneStorage,
  ) {
    this.currentZoneId = zoneId;
    this.scene.addEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
    this.scene.addEventListener(ZONE_RECENTER_REQUEST_EVENT, this.onRecenterRequest);
    this.scene.addEventListener(ZONE_SWITCH_REQUEST_EVENT, this.onSwitchZoneRequest);
    this.scene.addEventListener(ZONE_ADD_CONTENT_REQUEST_EVENT, this.onAddContentRequest);
  }

  getZoneId(): string {
    return this.currentZoneId;
  }

  async init(): Promise<void> {
    this.clearSpawnedPanels();
    const pack = await this.loadZonePack();
    const pdfRecord = (await this.storage.loadPdfFile?.(this.currentZoneId)) ?? null;
    const specs = buildInitialZonePanels(pack);
    const saved = await this.storage.loadLayout(this.currentZoneId);
    const layouts = resolveInitialPanelLayouts(
      saved,
      specs.map((spec) => spec.defaultLayout),
    );
    const layoutById = new Map(layouts.map((item) => [item.panelId, item]));

    for (const spec of specs) {
      const placement = layoutById.get(spec.panelId) ?? spec.defaultLayout;
      this.spawnPanel(spec, placement, pack, pdfRecord);
    }
  }

  async recenter(cameraYawDeg: number): Promise<PanelLayout[]> {
    const current = this.collectCurrentLayouts();
    const nextLayouts = recenterPanelLayouts(
      current.length > 0 ? current : DEFAULT_INITIAL_PANEL_LAYOUTS,
      cameraYawDeg,
    );

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
    this.scene.removeEventListener(ZONE_RECENTER_REQUEST_EVENT, this.onRecenterRequest);
    this.scene.removeEventListener(ZONE_SWITCH_REQUEST_EVENT, this.onSwitchZoneRequest);
    this.scene.removeEventListener(ZONE_ADD_CONTENT_REQUEST_EVENT, this.onAddContentRequest);
  }

  assignCardToSlot(card: StudyCard, sourceTitle = 'Material de estudo'): void {
    // preenche alternadamente os slots de cartão (panel-card-1 e panel-card-2) a partir do menu conteúdos
    const slotIds = ['panel-card-1', 'panel-card-2'] as const;
    const targetId = slotIds[this.nextCardSlotIndex % slotIds.length] ?? 'panel-card-1';
    this.nextCardSlotIndex += 1;

    const panelEl = this.containerEl.querySelector<Entity>(`#${targetId}`);
    if (!panelEl) return;
    const sourcePage = card.anchors[0]?.page ?? 1;
    panelEl.setAttribute('imx-card-panel', {
      cardId: card.id,
      title: card.title,
      body: card.body,
      sourcePage,
      sourceTitle,
    });
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
    // carrega o study pack revisado salvo no dexie ou recorre aos pacotes de demonstração
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

  private spawnPanel(
    spec: InitialZonePanelSpec,
    placement: PanelLayout,
    pack: StudyPack,
    pdfRecord: StoredPdfFile | null,
  ): void {
    const el = document.createElement('a-entity') as Entity;
    el.id = spec.panelId;

    el.setAttribute('imx-panel', {
      panelId: spec.panelId,
      yawDeg: placement.yawDeg,
      pitchDeg: placement.pitchDeg,
      radiusM: placement.radiusM,
    });

    if (spec.kind === 'card-panel' && spec.card) {
      const sourceTitle = pack.sources[0]?.title ?? 'Material de estudo';
      const sourcePage = spec.card.anchors[0]?.page ?? 1;
      el.setAttribute('imx-card-panel', {
        cardId: spec.card.id,
        title: spec.card.title,
        body: spec.card.body,
        sourcePage,
        sourceTitle,
      });
    } else if (spec.kind === 'pdf-panel') {
      let pdfUrl = '';
      if (pdfRecord && typeof URL.createObjectURL === 'function') {
        const bytes = new Uint8Array(pdfRecord.data);
        pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
        this.activePdfBlobUrl = pdfUrl;
      }
      el.setAttribute('imx-pdf-panel', {
        pdfUrl,
        sourceTitle: pdfRecord?.title ?? spec.sourceTitle ?? 'Documento PDF',
        page: 1,
        pageCount: spec.pageCount ?? 4,
      });
    }

    el.setAttribute('imx-drag-handle', {
      cameraSelector: '#main-camera',
    });

    this.containerEl.appendChild(el);

    if (spec.kind === 'pdf-panel' && !pdfRecord) {
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
  }
}
