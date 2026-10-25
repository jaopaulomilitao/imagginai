import {
  FORBIDDEN_TELEMETRY_KEYS,
  type ConceptQuizAccuracy,
  type ConceptTimeBucket,
  type SessionAggregateEnvelope,
  type SessionAggregatePayload,
  type TelemetryEvent,
  type TelemetryPayload,
} from '../../shared/types/telemetry';

export const CONCEPT_BUCKET_SHORT_MAX_MS = 5000;
export const CONCEPT_BUCKET_MEDIUM_MAX_MS = 30000;
export const PINCH_REPEAT_WINDOW_MS = 1000;

// classifica o tempo acumulado em um conceito nas três faixas da seção 3.9
export function classifyConceptTimeBucket(durationMs: number): ConceptTimeBucket {
  if (durationMs <= CONCEPT_BUCKET_SHORT_MAX_MS) {
    return '0-5s';
  }
  if (durationMs <= CONCEPT_BUCKET_MEDIUM_MAX_MS) {
    return '5-30s';
  }
  return '>30s';
}

// verifica se o nome de uma chave corresponde a dados biométricos ou brutos proibidos
export function isForbiddenTelemetryKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return FORBIDDEN_TELEMETRY_KEYS.some((forbidden) => normalized.includes(forbidden));
}

// remove recursivamente ou superficialmente qualquer campo proibido antes de gravar ou transmitir
export function sanitizeTelemetryPayload(raw: Record<string, unknown>): TelemetryPayload {
  const clean: TelemetryPayload = {};
  for (const [key, value] of Object.entries(raw)) {
    if (isForbiddenTelemetryKey(key)) {
      continue;
    }
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

// garante que nenhum campo proibido exista em qualquer nível de um objeto serializável
export function containsForbiddenTelemetryField(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenTelemetryField(item));
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenTelemetryKey(key)) {
      return true;
    }
    if (containsForbiddenTelemetryField(nested)) {
      return true;
    }
  }
  return false;
}

export function computePercentile(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(100, percentile));
  const index = Math.floor(((sorted.length - 1) * clamped) / 100);
  const val = sorted[index] ?? 0;
  return Math.round(val * 10) / 10;
}

export interface AggregateSessionParams {
  readonly sessionId: string;
  readonly zoneId: string;
  readonly events: readonly TelemetryEvent[];
  readonly fallbackFocusTimeMs?: number;
  readonly completedPomodoroBlocks?: number;
  readonly nowIso?: string;
}

// agrega os eventos locais da sessão em métricas anônimas prontas para sincronização (seção 3.9)
export function aggregateSessionTelemetry(
  params: AggregateSessionParams,
): SessionAggregateEnvelope {
  const conceptTimeMs: Record<string, number> = {};
  const conceptOpens: Record<string, number> = {};
  const quizByConcept: Record<string, ConceptQuizAccuracy> = {};
  const modeTimeMs: Record<string, number> = {
    focus: 0,
    passthrough: 0,
  };

  let pinchSuccessCount = 0;
  let pinchMissCount = 0;
  let pinchRepeatCount = 0;
  let completedBlocks = params.completedPomodoroBlocks ?? 0;

  const fpsP50Samples: number[] = [];
  const fpsP10Samples: number[] = [];

  const sortedEvents = [...params.events].sort((a, b) => a.tMonoMs - b.tMonoMs);
  let currentMode = 'focus';
  let lastModeSwitchMs = sortedEvents[0]?.tMonoMs ?? 0;

  for (const event of sortedEvents) {
    const payload = sanitizeTelemetryPayload(event.payload);

    switch (event.type) {
      case 'concept.focus': {
        const conceptId = typeof payload.conceptId === 'string' ? payload.conceptId : '';
        const durationMs =
          typeof payload.durationMs === 'number' ? Math.max(0, payload.durationMs) : 0;
        if (conceptId) {
          conceptTimeMs[conceptId] = (conceptTimeMs[conceptId] ?? 0) + durationMs;
        }
        break;
      }
      case 'concept.open': {
        const conceptId = typeof payload.conceptId === 'string' ? payload.conceptId : '';
        if (conceptId) {
          conceptOpens[conceptId] = (conceptOpens[conceptId] ?? 0) + 1;
          if (!(conceptId in conceptTimeMs)) {
            conceptTimeMs[conceptId] = 0;
          }
        }
        break;
      }
      case 'quiz.answer': {
        const conceptId = typeof payload.conceptId === 'string' ? payload.conceptId : '';
        const isCorrect = payload.correct === true;
        if (conceptId) {
          const prev = quizByConcept[conceptId] ?? { correct: 0, incorrect: 0 };
          quizByConcept[conceptId] = {
            correct: prev.correct + (isCorrect ? 1 : 0),
            incorrect: prev.incorrect + (isCorrect ? 0 : 1),
          };
        }
        break;
      }
      case 'gesture.pinch.success': {
        pinchSuccessCount += 1;
        break;
      }
      case 'gesture.pinch.miss': {
        pinchMissCount += 1;
        break;
      }
      case 'gesture.pinch.repeat': {
        pinchRepeatCount += 1;
        break;
      }
      case 'mode.switch': {
        const elapsed = Math.max(0, event.tMonoMs - lastModeSwitchMs);
        modeTimeMs[currentMode] = (modeTimeMs[currentMode] ?? 0) + elapsed;
        const nextMode = typeof payload.mode === 'string' ? payload.mode : currentMode;
        currentMode = nextMode;
        lastModeSwitchMs = event.tMonoMs;
        break;
      }
      case 'pomodoro.block.end': {
        completedBlocks = Math.max(completedBlocks, completedBlocks + 1);
        break;
      }
      case 'perf.window': {
        if (typeof payload.fpsP50 === 'number' && payload.fpsP50 > 0) {
          fpsP50Samples.push(payload.fpsP50);
        }
        if (typeof payload.fpsP10 === 'number' && payload.fpsP10 > 0) {
          fpsP10Samples.push(payload.fpsP10);
        }
        break;
      }
      default:
        break;
    }
  }

  if (sortedEvents.length > 1) {
    const lastEventMs = sortedEvents[sortedEvents.length - 1]?.tMonoMs ?? lastModeSwitchMs;
    const tailElapsed = Math.max(0, lastEventMs - lastModeSwitchMs);
    modeTimeMs[currentMode] = (modeTimeMs[currentMode] ?? 0) + tailElapsed;
  } else if (params.fallbackFocusTimeMs && params.fallbackFocusTimeMs > 0) {
    modeTimeMs.focus = params.fallbackFocusTimeMs;
  }

  const conceptTimeBuckets: Record<string, ConceptTimeBucket> = {};
  for (const [conceptId, ms] of Object.entries(conceptTimeMs)) {
    conceptTimeBuckets[conceptId] = classifyConceptTimeBucket(ms);
  }

  const totalModeMs = Object.values(modeTimeMs).reduce((acc, val) => acc + val, 0);
  const totalFocusTimeMs =
    totalModeMs > 0 ? totalModeMs : Math.max(0, params.fallbackFocusTimeMs ?? 0);

  const totalPinches = pinchSuccessCount + pinchMissCount;
  const pinchSuccessRate =
    totalPinches > 0 ? Math.round((pinchSuccessCount / totalPinches) * 1000) / 1000 : 1;

  const fpsP50 = fpsP50Samples.length > 0 ? computePercentile(fpsP50Samples, 50) : 60;
  const fpsP10 = fpsP10Samples.length > 0 ? computePercentile(fpsP10Samples, 10) : 55;

  const aggregatePayload: SessionAggregatePayload = {
    totalFocusTimeMs: Math.round(totalFocusTimeMs),
    conceptTimeMs,
    conceptTimeBuckets,
    conceptOpens,
    quizByConcept,
    pinchSuccessCount,
    pinchMissCount,
    pinchRepeatCount,
    pinchSuccessRate,
    modeTimeMs,
    fpsP50,
    fpsP10,
    completedPomodoroBlocks: completedBlocks,
  };

  return {
    sessionId: params.sessionId,
    zoneId: params.zoneId,
    payload: aggregatePayload,
    createdAt: params.nowIso ?? new Date().toISOString(),
    synced: false,
  };
}
