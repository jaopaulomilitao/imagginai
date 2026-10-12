import Dexie, { type Table } from 'dexie';

import { logger } from '../logger';
import type { StudyPack } from '../types/study-pack';
import type { PanelLayout, Zone } from '../types/zone';

export interface StoredZoneLayout {
  zoneId: string;
  layout: PanelLayout[];
  updatedAt: string;
}

export interface StoredStudyPack {
  packId: string;
  zoneId: string;
  pack: StudyPack;
  savedAt: string;
}

export interface StoredZoneSessionState {
  zoneId: string;
  completedPomodoroBlocks: number;
  exitedAt: string;
}

export interface LayoutRepository {
  loadLayout(zoneId: string): Promise<PanelLayout[] | null>;
  saveLayout(zoneId: string, layout: PanelLayout[]): Promise<void>;
  upsertPanelLayout(
    zoneId: string,
    panel: PanelLayout,
    fallbackLayout: readonly PanelLayout[],
  ): Promise<PanelLayout[]>;
  saveSessionState?(state: StoredZoneSessionState): Promise<void>;
  loadSessionState?(zoneId: string): Promise<StoredZoneSessionState | null>;
  listDownloadedZones?(): Promise<Zone[]>;
}

// banco local em indexeddb via dexie; localstorage é proibido para packs, layouts e telemetria (seção 2.2)
export class ImagginaiDatabase extends Dexie {
  zones!: Table<Zone, string>;
  zoneLayouts!: Table<StoredZoneLayout, string>;
  studyPacks!: Table<StoredStudyPack, string>;
  sessionStates!: Table<StoredZoneSessionState, string>;

  constructor(name = 'imagginai-db') {
    super(name);
    this.version(1).stores({
      zones: 'id, packId, updatedAt',
      zoneLayouts: 'zoneId, updatedAt',
      studyPacks: 'packId, zoneId, savedAt',
    });
    this.version(2).stores({
      zones: 'id, packId, updatedAt',
      zoneLayouts: 'zoneId, updatedAt',
      studyPacks: 'packId, zoneId, savedAt',
      sessionStates: 'zoneId, exitedAt',
    });
  }
}

export function mergePanelIntoLayout(
  existing: readonly PanelLayout[],
  updated: PanelLayout,
): PanelLayout[] {
  const index = existing.findIndex((item) => item.panelId === updated.panelId);
  if (index === -1) {
    return [...existing, updated];
  }
  return existing.map((item, idx) => (idx === index ? updated : item));
}

export class DexieLayoutRepository implements LayoutRepository {
  private readonly memoryFallback = new Map<string, PanelLayout[]>();
  private readonly sessionFallback = new Map<string, StoredZoneSessionState>();

  constructor(private readonly db: ImagginaiDatabase = new ImagginaiDatabase()) {}

  async loadLayout(zoneId: string): Promise<PanelLayout[] | null> {
    try {
      const record = await this.db.zoneLayouts.get(zoneId);
      if (record) return record.layout;
      const zone = await this.db.zones.get(zoneId);
      if (zone && zone.layout.length > 0) return zone.layout;
    } catch (error) {
      logger.warn('dexie loadLayout fell back to memory', error);
    }
    return this.memoryFallback.get(zoneId) ?? null;
  }

  async saveLayout(zoneId: string, layout: PanelLayout[]): Promise<void> {
    const copy = layout.map((item) => ({ ...item }));
    this.memoryFallback.set(zoneId, copy);
    const updatedAt = new Date().toISOString();
    try {
      await this.db.zoneLayouts.put({ zoneId, layout: copy, updatedAt });
      const existingZone = await this.db.zones.get(zoneId);
      if (existingZone) {
        await this.db.zones.put({ ...existingZone, layout: copy, updatedAt });
      }
    } catch (error) {
      logger.warn('dexie saveLayout fell back to memory', error);
    }
  }

  async upsertPanelLayout(
    zoneId: string,
    panel: PanelLayout,
    fallbackLayout: readonly PanelLayout[],
  ): Promise<PanelLayout[]> {
    const current = (await this.loadLayout(zoneId)) ?? [...fallbackLayout];
    const next = mergePanelIntoLayout(current, panel);
    await this.saveLayout(zoneId, next);
    return next;
  }

  async saveSessionState(state: StoredZoneSessionState): Promise<void> {
    this.sessionFallback.set(state.zoneId, { ...state });
    try {
      await this.db.sessionStates.put({ ...state });
    } catch (error) {
      logger.warn('dexie saveSessionState fell back to memory', error);
    }
  }

  async loadSessionState(zoneId: string): Promise<StoredZoneSessionState | null> {
    try {
      const record = await this.db.sessionStates.get(zoneId);
      if (record) return record;
    } catch (error) {
      logger.warn('dexie loadSessionState fell back to memory', error);
    }
    return this.sessionFallback.get(zoneId) ?? null;
  }

  async listDownloadedZones(): Promise<Zone[]> {
    try {
      const zones = await this.db.zones.toArray();
      return zones.filter((zone) => zone.packId !== null);
    } catch (error) {
      logger.warn('dexie listDownloadedZones failed', error);
      return [];
    }
  }
}

export const zoneStorage = new DexieLayoutRepository();
