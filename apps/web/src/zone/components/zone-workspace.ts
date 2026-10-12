import type { Entity, Scene } from 'aframe';

import demoPackRaw from '../../../../../fixtures/demo-pack.json';
import { logger } from '../../shared/logger';
import { zoneStorage, type LayoutRepository } from '../../shared/storage/dexie-db';
import type { StudyPack } from '../../shared/types/study-pack';
import type { PanelLayout } from '../../shared/types/zone';
import { validateStudyPack } from '../../shared/validation/study-pack-validator';
import { PANEL_DROP_EVENT } from './imx-drag-handle';
import type { PdfPanelComponent } from './imx-pdf-panel';
import {
  buildDemoPdfPageContent,
  buildInitialZonePanels,
  DEFAULT_INITIAL_PANEL_LAYOUTS,
  resolveInitialPanelLayouts,
  type InitialZonePanelSpec,
} from '../systems/initial-panels';

export class ZoneWorkspaceController {
  private readonly onPanelDrop = (event: Event): void => {
    const updated = (event as CustomEvent<PanelLayout>).detail;
    void this.storage
      .upsertPanelLayout(this.zoneId, updated, DEFAULT_INITIAL_PANEL_LAYOUTS)
      .catch((error: unknown) => {
        logger.error('failed to persist panel layout on drop', error);
      });
  };

  constructor(
    private readonly scene: Scene,
    private readonly containerEl: Entity,
    private readonly zoneId: string,
    private readonly storage: LayoutRepository = zoneStorage,
  ) {
    this.scene.addEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
  }

  async init(): Promise<void> {
    const pack = this.loadValidatedDemoPack();
    const specs = buildInitialZonePanels(pack);
    const saved = await this.storage.loadLayout(this.zoneId);
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

  dispose(): void {
    this.scene.removeEventListener(PANEL_DROP_EVENT, this.onPanelDrop);
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
