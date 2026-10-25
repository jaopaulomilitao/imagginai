import Dexie, { type Table } from 'dexie';

import demoCardioPackRaw from '../../../../../fixtures/demo-pack.json';
import demoEngineeringPackRaw from '../../../public/demo-packs/engineering-dc-circuits.json';
import demoHealthPackRaw from '../../../public/demo-packs/health-human-anatomy.json';
import { logger } from '../logger';
import type { StudyPack } from '../types/study-pack';
import type { SessionAggregateEnvelope, TelemetryEvent } from '../types/telemetry';
import type { PanelLayout, Zone } from '../types/zone';
import { validateStudyPack } from '../validation/study-pack-validator';

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

export interface StoredPdfFile {
  zoneId: string;
  sourceId: string;
  title: string;
  data: Uint8Array;
  savedAt: string;
}

export interface StoredUserConsent {
  id: 'user-consent';
  telemetryLocal: boolean;
  research: boolean;
  updatedAt: string;
}

export interface StoredTelemetryEvent extends TelemetryEvent {
  id?: number;
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
  loadLatestSessionState?(): Promise<StoredZoneSessionState | null>;
  listDownloadedZones?(): Promise<Zone[]>;
  listZones?(): Promise<Zone[]>;
  getZone?(zoneId: string): Promise<Zone | null>;
  saveZone?(zone: Zone): Promise<void>;
  deleteZone?(zoneId: string): Promise<void>;
  saveStudyPack?(zoneId: string, pack: StudyPack): Promise<void>;
  loadStudyPack?(zoneId: string): Promise<StudyPack | null>;
  savePdfFile?(record: StoredPdfFile): Promise<void>;
  loadPdfFile?(zoneId: string): Promise<StoredPdfFile | null>;
  loadConsent?(): Promise<StoredUserConsent | null>;
  saveConsent?(consent: Omit<StoredUserConsent, 'id' | 'updatedAt'>): Promise<StoredUserConsent>;
  appendTelemetryEvent?(event: TelemetryEvent): Promise<void>;
  listTelemetryEvents?(sessionId: string): Promise<TelemetryEvent[]>;
  saveSessionAggregate?(aggregate: SessionAggregateEnvelope): Promise<void>;
  listSessionAggregates?(zoneId?: string): Promise<SessionAggregateEnvelope[]>;
  listUnsyncedAggregates?(): Promise<SessionAggregateEnvelope[]>;
  markAggregateSynced?(sessionId: string): Promise<void>;
  clearAllLocalData?(): Promise<void>;
}

const BUNDLED_DEMO_PACKS: readonly {
  zoneId: string;
  name: string;
  environment: Zone['environment'];
  rawPack: unknown;
}[] = [
  {
    zoneId: 'demo',
    name: 'Sistema Cardiovascular (Demo)',
    environment: 'focus-dark',
    rawPack: demoCardioPackRaw,
  },
  {
    zoneId: 'zone-demo-engenharia-circuitos-cc',
    name: 'Engenharia — Circuitos Elétricos CC (Demo)',
    environment: 'focus-dark',
    rawPack: demoEngineeringPackRaw,
  },
  {
    zoneId: 'zone-demo-saude-anatomia-humana',
    name: 'Saúde — Anatomia Humana Prática (Demo)',
    environment: 'focus-nature',
    rawPack: demoHealthPackRaw,
  },
];

// banco local em indexeddb via dexie; localstorage é proibido para packs, layouts e telemetria (seção 2.2)
export class ImagginaiDatabase extends Dexie {
  zones!: Table<Zone, string>;
  zoneLayouts!: Table<StoredZoneLayout, string>;
  studyPacks!: Table<StoredStudyPack, string>;
  sessionStates!: Table<StoredZoneSessionState, string>;
  pdfFiles!: Table<StoredPdfFile, string>;
  consents!: Table<StoredUserConsent, string>;
  telemetryEvents!: Table<StoredTelemetryEvent, number>;
  sessionAggregates!: Table<SessionAggregateEnvelope, string>;

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
    this.version(3).stores({
      zones: 'id, packId, updatedAt',
      zoneLayouts: 'zoneId, updatedAt',
      studyPacks: 'packId, zoneId, savedAt',
      sessionStates: 'zoneId, exitedAt',
      pdfFiles: 'zoneId, sourceId, savedAt',
      consents: 'id, updatedAt',
    });
    this.version(4).stores({
      zones: 'id, packId, updatedAt',
      zoneLayouts: 'zoneId, updatedAt',
      studyPacks: 'packId, zoneId, savedAt',
      sessionStates: 'zoneId, exitedAt',
      pdfFiles: 'zoneId, sourceId, savedAt',
      consents: 'id, updatedAt',
      telemetryEvents: '++id, sessionId, zoneId, type, tMonoMs',
      sessionAggregates: 'sessionId, zoneId, synced, createdAt',
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

export function resolveBundledDemoPack(zoneId: string): StudyPack | null {
  // retorna um pacote demonstrativo apenas quando o id pertence de fato a uma zona demo oficial
  const normalizedId = zoneId === 'zone-demo' ? 'demo' : zoneId;
  const entry = BUNDLED_DEMO_PACKS.find((item) => item.zoneId === normalizedId);
  if (!entry) return null;
  const validated = validateStudyPack(entry.rawPack);
  return validated.ok ? validated.pack : null;
}

export class DexieLayoutRepository implements LayoutRepository {
  private readonly memoryFallback = new Map<string, PanelLayout[]>();
  private readonly sessionFallback = new Map<string, StoredZoneSessionState>();
  private readonly zoneFallback = new Map<string, Zone>();
  private readonly packFallback = new Map<string, StudyPack>();
  private readonly pdfFallback = new Map<string, StoredPdfFile>();
  private readonly telemetryEventsFallback: TelemetryEvent[] = [];
  private readonly aggregatesFallback = new Map<string, SessionAggregateEnvelope>();
  private consentFallback: StoredUserConsent | null = null;
  private demoSeeded = false;

  constructor(private readonly db: ImagginaiDatabase = new ImagginaiDatabase()) {}

  async ensureDemoZonesSeeded(): Promise<void> {
    if (this.demoSeeded) return;
    this.demoSeeded = true;
    const now = new Date().toISOString();
    for (const demo of BUNDLED_DEMO_PACKS) {
      const validated = validateStudyPack(demo.rawPack);
      if (!validated.ok) continue;
      const pack: StudyPack = { ...validated.pack, zoneId: demo.zoneId };
      const zone: Zone = {
        id: demo.zoneId,
        name: demo.name,
        environment: demo.environment,
        sourceIds: pack.sources.map((src) => src.id),
        packId: pack.packId,
        layout: [],
        createdAt: now,
        updatedAt: now,
      };
      if (!this.zoneFallback.has(demo.zoneId)) {
        this.zoneFallback.set(demo.zoneId, zone);
      }
      if (!this.packFallback.has(demo.zoneId)) {
        this.packFallback.set(demo.zoneId, pack);
      }
      try {
        const existingZone = await this.db.zones.get(demo.zoneId);
        if (!existingZone) {
          await this.db.zones.put(zone);
        }
        const existingPack = await this.db.studyPacks.where('zoneId').equals(demo.zoneId).first();
        if (!existingPack) {
          await this.db.studyPacks.put({
            packId: pack.packId,
            zoneId: demo.zoneId,
            pack,
            savedAt: now,
          });
        }
      } catch (error) {
        logger.warn('dexie demo seed fell back to memory', error);
      }
    }
  }

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

  async loadLatestSessionState(): Promise<StoredZoneSessionState | null> {
    let states: StoredZoneSessionState[] = [...this.sessionFallback.values()];
    try {
      const dbStates = await this.db.sessionStates.toArray();
      if (dbStates.length > 0) {
        states = dbStates;
      }
    } catch (error) {
      logger.warn('dexie loadLatestSessionState fell back to memory', error);
    }
    if (states.length === 0) return null;
    return [...states].sort((a, b) => b.exitedAt.localeCompare(a.exitedAt))[0] ?? null;
  }

  async listZones(): Promise<Zone[]> {
    await this.ensureDemoZonesSeeded();
    try {
      const zones = await this.db.zones.toArray();
      if (zones.length > 0) {
        return zones.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
    } catch (error) {
      logger.warn('dexie listZones fell back to memory', error);
    }
    return [...this.zoneFallback.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getZone(zoneId: string): Promise<Zone | null> {
    await this.ensureDemoZonesSeeded();
    try {
      const zone = await this.db.zones.get(zoneId);
      if (zone) return zone;
    } catch (error) {
      logger.warn('dexie getZone fell back to memory', error);
    }
    return this.zoneFallback.get(zoneId) ?? null;
  }

  async saveZone(zone: Zone): Promise<void> {
    this.zoneFallback.set(zone.id, { ...zone });
    try {
      await this.db.zones.put({ ...zone });
    } catch (error) {
      logger.warn('dexie saveZone fell back to memory', error);
    }
  }

  async deleteZone(zoneId: string): Promise<void> {
    this.zoneFallback.delete(zoneId);
    this.packFallback.delete(zoneId);
    this.memoryFallback.delete(zoneId);
    this.sessionFallback.delete(zoneId);
    this.pdfFallback.delete(zoneId);
    try {
      await this.db.zones.delete(zoneId);
      await this.db.zoneLayouts.delete(zoneId);
      await this.db.sessionStates.delete(zoneId);
      await this.db.pdfFiles.delete(zoneId);
      const packs = await this.db.studyPacks.where('zoneId').equals(zoneId).toArray();
      for (const pack of packs) {
        await this.db.studyPacks.delete(pack.packId);
      }
    } catch (error) {
      logger.warn('dexie deleteZone fell back to memory', error);
    }
  }

  async listDownloadedZones(): Promise<Zone[]> {
    const zones = await this.listZones();
    return zones.filter((zone) => zone.packId !== null);
  }

  async saveStudyPack(zoneId: string, pack: StudyPack): Promise<void> {
    const normalized: StudyPack = { ...pack, zoneId };
    this.packFallback.set(zoneId, normalized);
    const savedAt = new Date().toISOString();
    try {
      await this.db.studyPacks.put({
        packId: normalized.packId,
        zoneId,
        pack: normalized,
        savedAt,
      });
      const existingZone = await this.db.zones.get(zoneId);
      if (existingZone) {
        const updatedZone: Zone = {
          ...existingZone,
          packId: normalized.packId,
          sourceIds: normalized.sources.map((src) => src.id),
          updatedAt: savedAt,
        };
        this.zoneFallback.set(zoneId, updatedZone);
        await this.db.zones.put(updatedZone);
      }
    } catch (error) {
      logger.warn('dexie saveStudyPack fell back to memory', error);
    }
  }

  async loadStudyPack(zoneId: string): Promise<StudyPack | null> {
    await this.ensureDemoZonesSeeded();
    try {
      const record = await this.db.studyPacks.where('zoneId').equals(zoneId).first();
      if (record) return record.pack;
    } catch (error) {
      logger.warn('dexie loadStudyPack fell back to memory', error);
    }
    return this.packFallback.get(zoneId) ?? resolveBundledDemoPack(zoneId);
  }

  async savePdfFile(record: StoredPdfFile): Promise<void> {
    this.pdfFallback.set(record.zoneId, record);
    try {
      await this.db.pdfFiles.put(record);
    } catch (error) {
      logger.warn('dexie savePdfFile fell back to memory', error);
    }
  }

  async loadPdfFile(zoneId: string): Promise<StoredPdfFile | null> {
    try {
      const record = await this.db.pdfFiles.get(zoneId);
      if (record) return record;
      // busca o pdf mais recente gravado localmente para garantir o binding mesmo com ids alternativos (seção 5)
      const latest = await this.db.pdfFiles.orderBy('savedAt').last();
      if (latest) return latest;
    } catch (error) {
      logger.warn('dexie loadPdfFile fell back to memory', error);
    }
    return this.pdfFallback.get(zoneId) ?? Array.from(this.pdfFallback.values()).pop() ?? null;
  }

  async loadConsent(): Promise<StoredUserConsent | null> {
    try {
      const record = await this.db.consents.get('user-consent');
      if (record) return record;
    } catch (error) {
      logger.warn('dexie loadConsent fell back to memory', error);
    }
    return this.consentFallback;
  }

  async saveConsent(
    consent: Omit<StoredUserConsent, 'id' | 'updatedAt'>,
  ): Promise<StoredUserConsent> {
    const record: StoredUserConsent = {
      id: 'user-consent',
      telemetryLocal: consent.telemetryLocal,
      research: consent.research,
      updatedAt: new Date().toISOString(),
    };
    this.consentFallback = record;
    try {
      await this.db.consents.put(record);
    } catch (error) {
      logger.warn('dexie saveConsent fell back to memory', error);
    }
    return record;
  }

  async appendTelemetryEvent(event: TelemetryEvent): Promise<void> {
    const copy: TelemetryEvent = {
      ...event,
      payload: { ...event.payload },
    };
    this.telemetryEventsFallback.push(copy);
    try {
      await this.db.telemetryEvents.add(copy);
    } catch (error) {
      logger.warn('dexie appendTelemetryEvent fell back to memory', error);
    }
  }

  async listTelemetryEvents(sessionId: string): Promise<TelemetryEvent[]> {
    try {
      const rows = await this.db.telemetryEvents.where('sessionId').equals(sessionId).toArray();
      if (rows.length > 0) {
        return rows.map((row) => ({
          sessionId: row.sessionId,
          zoneId: row.zoneId,
          type: row.type,
          tMonoMs: row.tMonoMs,
          payload: { ...row.payload },
        }));
      }
    } catch (error) {
      logger.warn('dexie listTelemetryEvents fell back to memory', error);
    }
    return this.telemetryEventsFallback.filter((item) => item.sessionId === sessionId);
  }

  async saveSessionAggregate(aggregate: SessionAggregateEnvelope): Promise<void> {
    const copy: SessionAggregateEnvelope = {
      ...aggregate,
      payload: { ...aggregate.payload },
    };
    this.aggregatesFallback.set(copy.sessionId, copy);
    try {
      await this.db.sessionAggregates.put(copy);
    } catch (error) {
      logger.warn('dexie saveSessionAggregate fell back to memory', error);
    }
  }

  async listSessionAggregates(zoneId?: string): Promise<SessionAggregateEnvelope[]> {
    let items: SessionAggregateEnvelope[] = [...this.aggregatesFallback.values()];
    try {
      const dbItems = zoneId
        ? await this.db.sessionAggregates.where('zoneId').equals(zoneId).toArray()
        : await this.db.sessionAggregates.toArray();
      if (dbItems.length > 0) {
        items = dbItems;
      }
    } catch (error) {
      logger.warn('dexie listSessionAggregates fell back to memory', error);
    }
    if (zoneId) {
      items = items.filter((item) => item.zoneId === zoneId);
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listUnsyncedAggregates(): Promise<SessionAggregateEnvelope[]> {
    const all = await this.listSessionAggregates();
    return all.filter((item) => !item.synced);
  }

  async markAggregateSynced(sessionId: string): Promise<void> {
    const existing = this.aggregatesFallback.get(sessionId);
    if (existing) {
      this.aggregatesFallback.set(sessionId, { ...existing, synced: true });
    }
    try {
      const dbRecord = await this.db.sessionAggregates.get(sessionId);
      if (dbRecord) {
        await this.db.sessionAggregates.put({ ...dbRecord, synced: true });
      }
    } catch (error) {
      logger.warn('dexie markAggregateSynced fell back to memory', error);
    }
  }

  async clearAllLocalData(): Promise<void> {
    this.memoryFallback.clear();
    this.sessionFallback.clear();
    this.zoneFallback.clear();
    this.packFallback.clear();
    this.pdfFallback.clear();
    this.telemetryEventsFallback.length = 0;
    this.aggregatesFallback.clear();
    this.consentFallback = null;
    this.demoSeeded = false;
    try {
      await Promise.all([
        this.db.zones.clear(),
        this.db.zoneLayouts.clear(),
        this.db.studyPacks.clear(),
        this.db.sessionStates.clear(),
        this.db.pdfFiles.clear(),
        this.db.consents.clear(),
        this.db.telemetryEvents.clear(),
        this.db.sessionAggregates.clear(),
      ]);
    } catch (error) {
      logger.warn('dexie clearAllLocalData failed', error);
    }
  }
}

export const zoneStorage = new DexieLayoutRepository();
