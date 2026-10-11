import { logger } from '../core/logger';

export type TelemetryPayload = Record<string, number | string | boolean>;

// mapa de tipo de evento → formato do payload, definido por quem usa o barramento
export type TelemetryEventMap = Record<string, TelemetryPayload>;

export interface TelemetryRecord<
  TMap extends TelemetryEventMap,
  K extends keyof TMap = keyof TMap,
> {
  type: K;
  // relógio monotônico (performance.now), imune a ajustes do relógio do sistema
  tMonoMs: number;
  payload: TMap[K];
}

export type AnyTelemetryRecord<TMap extends TelemetryEventMap> = {
  [K in keyof TMap]: TelemetryRecord<TMap, K>;
}[keyof TMap];

type Listener<T> = (record: T) => void;

// barramento tipado e síncrono; não persiste nem transmite nada por conta própria
export class TelemetryBus<TMap extends TelemetryEventMap> {
  private readonly typed = new Map<keyof TMap, Set<Listener<AnyTelemetryRecord<TMap>>>>();
  private readonly wildcard = new Set<Listener<AnyTelemetryRecord<TMap>>>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  emit<K extends keyof TMap>(type: K, payload: TMap[K]): void {
    const record = { type, tMonoMs: this.now(), payload } as AnyTelemetryRecord<TMap>;
    this.typed.get(type)?.forEach((listener) => this.deliver(listener, record));
    this.wildcard.forEach((listener) => this.deliver(listener, record));
  }

  on<K extends keyof TMap>(type: K, listener: Listener<TelemetryRecord<TMap, K>>): () => void {
    const listeners = this.typed.get(type) ?? new Set();
    const erased = listener as Listener<AnyTelemetryRecord<TMap>>;
    listeners.add(erased);
    this.typed.set(type, listeners);
    return () => listeners.delete(erased);
  }

  onAny(listener: Listener<AnyTelemetryRecord<TMap>>): () => void {
    this.wildcard.add(listener);
    return () => this.wildcard.delete(listener);
  }

  clear(): void {
    this.typed.clear();
    this.wildcard.clear();
  }

  private deliver(listener: Listener<AnyTelemetryRecord<TMap>>, record: AnyTelemetryRecord<TMap>) {
    // a falha de um ouvinte não impede a entrega aos demais
    try {
      listener(record);
    } catch (error) {
      logger.error(`telemetry listener failed for "${String(record.type)}"`, error);
    }
  }
}
