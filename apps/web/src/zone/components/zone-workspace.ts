import type { Entity, Scene } from 'aframe';

import demoPackRaw from '../../../../../fixtures/demo-pack.json';
import { logger } from '../../shared/logger';
import { zoneStorage, type LayoutRepository } from '../../shared/storage/dexie-db';
import type { StudyPack } from '../../shared/types/study-pack';
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

export interface RecenterRequestDetail {
  readonly cameraYawDeg: number;
}

export interface SwitchZoneRequestDetail {
  readonly zoneId: string;
}

export class ZoneWorkspaceController {
  private currentZoneId: string;

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
  }

  getZoneId(): string {
    return this.currentZoneId;
  }

  async init(): Promise<void> {
    this.clearSpawnedPanels();
    const pack = this.loadValidatedDemoPack();
    const specs = buildInitialZonePanels(pack);
    const saved = await this.storage.loadLayout(this.currentZoneId);
    const layouts = resolveInitialPanelLayouts(
      saved,
      specs.map((spec) => spec.defaultLayout),
    );
    const layoutById = new Map(layouts.map((item) => [item.panelId, item]));

    for (const spec of specs) {
      const placement = layoutById.get(spec.panelId) ?? spec.defaultLayout;
      this.spawnPanel(spec, placement, pack);
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
    this.scene.removeEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
    this.scene.removeEventListener(ZONE_RECENTER_REQUEST_EVENT, this.onRecenterRequest);
    this.scene.removeEventListener(ZONE_SWITCH_REQUEST_EVENT, this.onSwitchZoneRequest);
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
    while (this.containerEl.firstChild) {
      this.containerEl.removeChild(this.containerEl.firstChild);
    }
  }

  private loadValidatedDemoPack(): StudyPack {
    const result = validateStudyPack(demoPackRaw);
    if (!result.ok) {
      throw new Error(`invalid demo pack: ${result.errors.join('; ')}`);
    }
    return result.pack;
  }

  private spawnPanel(spec: InitialZonePanelSpec, placement: PanelLayout, pack: StudyPack): void {
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
      el.setAttribute('imx-pdf-panel', {
        pdfUrl: '',
        sourceTitle: spec.sourceTitle ?? 'Documento PDF',
        page: 1,
        pageCount: spec.pageCount ?? 4,
      });
    }

    el.setAttribute('imx-drag-handle', {
      cameraSelector: '#main-camera',
    });

    this.containerEl.appendChild(el);

    if (spec.kind === 'pdf-panel') {
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
