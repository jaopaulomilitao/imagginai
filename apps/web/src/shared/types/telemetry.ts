export type TelemetryEventType =
  | 'panel.dwell'
  | 'panel.open'
  | 'panel.move'
  | 'concept.focus'
  | 'concept.open'
  | 'gesture.pinch.success'
  | 'gesture.pinch.miss'
  | 'gesture.pinch.repeat'
  | 'belt.open'
  | 'belt.action'
  | 'mode.switch'
  | 'pomodoro.block.start'
  | 'pomodoro.block.end'
  | 'quiz.answer'
  | 'asset.sequence.check'
  | 'perf.window';

export type TelemetryPrimitive = number | string | boolean;

export type TelemetryPayload = Record<string, TelemetryPrimitive>;

export interface TelemetryEvent {
  sessionId: string;
  zoneId: string;
  type: TelemetryEventType;
  tMonoMs: number;
  payload: TelemetryPayload;
}

export type ConceptTimeBucket = '0-5s' | '5-30s' | '>30s';

export interface ConceptQuizAccuracy {
  correct: number;
  incorrect: number;
}

export interface SessionAggregatePayload {
  totalFocusTimeMs: number;
  conceptTimeMs: Record<string, number>;
  conceptTimeBuckets: Record<string, ConceptTimeBucket>;
  conceptOpens: Record<string, number>;
  quizByConcept: Record<string, ConceptQuizAccuracy>;
  pinchSuccessCount: number;
  pinchMissCount: number;
  pinchRepeatCount: number;
  pinchSuccessRate: number;
  modeTimeMs: Record<string, number>;
  fpsP50: number;
  fpsP10: number;
  completedPomodoroBlocks: number;
}

export interface SessionAggregateEnvelope {
  sessionId: string;
  zoneId: string;
  payload: SessionAggregatePayload;
  createdAt: string;
  synced: boolean;
}

// campos estritamente proibidos de serem persistidos ou transmitidos na telemetria (seção 3.9)
export const FORBIDDEN_TELEMETRY_KEYS: readonly string[] = [
  'landmarks',
  'rawlandmarks',
  'smoothedlandmarks',
  'headorientation',
  'headorientationseries',
  'headseries',
  'videoframe',
  'videoframes',
  'audio',
  'audiobuffer',
  'audiostream',
  'camerastream',
];
