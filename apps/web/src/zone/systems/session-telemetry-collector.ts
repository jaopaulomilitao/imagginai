import { zoneStorage, type LayoutRepository } from '../../shared/storage/dexie-db';
import type {
  SessionAggregateEnvelope,
  TelemetryEvent,
  TelemetryEventType,
  TelemetryPayload,
} from '../../shared/types/telemetry';
import {
  aggregateSessionTelemetry,
  PINCH_REPEAT_WINDOW_MS,
  sanitizeTelemetryPayload,
} from './telemetry-aggregator';

export interface ZoneTelemetryRecord {
  readonly type: TelemetryEventType;
  readonly tMonoMs: number;
  readonly payload: TelemetryPayload;
}

type ZoneTelemetryListener = (record: ZoneTelemetryRecord) => void;

// barramento puro de eventos de telemetria sem dependência de dom/aframe para execução em node e navegador
export class ZoneTelemetryBus {
  private readonly listeners = new Set<ZoneTelemetryListener>();

  constructor(private readonly now: () => number) {}

  emit(type: TelemetryEventType, payload: TelemetryPayload): void {
    const record: ZoneTelemetryRecord = {
      type,
      tMonoMs: this.now(),
      payload,
    };
    for (const listener of this.listeners) {
      listener(record);
    }
  }

  onAny(listener: ZoneTelemetryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.listeners.clear();
  }
}

// coletor de telemetria da sessão vr acoplado ao barramento tipado e ao dexie (seção 3.9)
export class SessionTelemetryCollector {
  readonly bus: ZoneTelemetryBus;
  readonly sessionId: string;
  private zoneId: string;
  private telemetryLocalEnabled = true;
  private researchConsentEnabled = false;
  private readonly sessionStartMonoMs: number;
  private readonly inMemoryEvents: TelemetryEvent[] = [];
  private readonly conceptOpenCounts: Record<string, number> = {};
  private lastPinchTargetId: string | null = null;
  private lastPinchTimeMs = -Infinity;
  private readonly unsubscribeBus: () => void;

  constructor(
    zoneId: string,
    private readonly storage: LayoutRepository = zoneStorage,
    private readonly now: () => number = () =>
      typeof performance !== 'undefined' ? performance.now() : Date.now(),
    sessionId?: string,
  ) {
    this.zoneId = zoneId;
    this.sessionStartMonoMs = this.now();
    this.sessionId = sessionId ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.bus = new ZoneTelemetryBus(this.now);

    this.unsubscribeBus = this.bus.onAny((record) => {
      const cleanPayload = sanitizeTelemetryPayload(record.payload);
      const event: TelemetryEvent = {
        sessionId: this.sessionId,
        zoneId: this.zoneId,
        type: record.type,
        tMonoMs: Math.round(record.tMonoMs - this.sessionStartMonoMs),
        payload: cleanPayload,
      };

      if (event.type === 'concept.open' && typeof cleanPayload.conceptId === 'string') {
        const cid = cleanPayload.conceptId;
        this.conceptOpenCounts[cid] = (this.conceptOpenCounts[cid] ?? 0) + 1;
      }

      if (this.telemetryLocalEnabled) {
        this.inMemoryEvents.push(event);
        void this.storage.appendTelemetryEvent?.(event);
      }
    });
  }

  async initConsent(): Promise<void> {
    const consent = await this.storage.loadConsent?.();
    if (consent) {
      this.telemetryLocalEnabled = consent.telemetryLocal;
      this.researchConsentEnabled = consent.research;
    } else {
      this.telemetryLocalEnabled = true;
      this.researchConsentEnabled = false;
    }
  }

  setConsentFlags(flags: { telemetryLocal: boolean; research: boolean }): void {
    this.telemetryLocalEnabled = flags.telemetryLocal;
    this.researchConsentEnabled = flags.research;
  }

  isResearchEnabled(): boolean {
    return this.researchConsentEnabled;
  }

  isTelemetryLocalEnabled(): boolean {
    return this.telemetryLocalEnabled;
  }

  setZoneId(nextZoneId: string): void {
    this.zoneId = nextZoneId;
  }

  getConceptOpens(): Readonly<Record<string, number>> {
    return { ...this.conceptOpenCounts };
  }

  getRecordedEvents(): readonly TelemetryEvent[] {
    return [...this.inMemoryEvents];
  }

  record(type: TelemetryEventType, payload: Record<string, unknown> = {}): void {
    const clean = sanitizeTelemetryPayload(payload);
    this.bus.emit(type, clean);
  }

  // registra tentativa de pinça classificando sucesso, erro sem alvo ou repetição rápida (< 1 s)
  recordPinchAttempt(targetId: string | null): void {
    const currentMono = this.now();
    if (!targetId) {
      this.record('gesture.pinch.miss', { hasTarget: false });
      this.lastPinchTargetId = null;
      this.lastPinchTimeMs = currentMono;
      return;
    }

    this.record('gesture.pinch.success', { targetId });
    if (
      this.lastPinchTargetId === targetId &&
      currentMono - this.lastPinchTimeMs < PINCH_REPEAT_WINDOW_MS
    ) {
      this.record('gesture.pinch.repeat', {
        targetId,
        intervalMs: Math.round(currentMono - this.lastPinchTimeMs),
      });
    }
    this.lastPinchTargetId = targetId;
    this.lastPinchTimeMs = currentMono;
  }

  async finalizeSession(completedPomodoroBlocks: number): Promise<SessionAggregateEnvelope | null> {
    if (!this.telemetryLocalEnabled) {
      return null;
    }
    const elapsedMs = Math.max(0, Math.round(this.now() - this.sessionStartMonoMs));
    const aggregate = aggregateSessionTelemetry({
      sessionId: this.sessionId,
      zoneId: this.zoneId,
      events: this.inMemoryEvents,
      fallbackFocusTimeMs: elapsedMs,
      completedPomodoroBlocks,
    });
    await this.storage.saveSessionAggregate?.(aggregate);
    return aggregate;
  }

  dispose(): void {
    this.unsubscribeBus();
    this.bus.clear();
  }
}
