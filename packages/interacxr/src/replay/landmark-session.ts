import { type Landmark, LANDMARK_COUNT } from '../core/landmarks';

// sessões gravadas existem apenas para testes e depuração locais; pontos da mão nunca saem do aparelho

export const LANDMARK_SESSION_VERSION = 1;

export interface LandmarkSessionFrame {
  // tempo relativo ao início da gravação, em milissegundos
  tMs: number;
  landmarks: Landmark[] | null;
}

export interface LandmarkSession {
  version: typeof LANDMARK_SESSION_VERSION;
  name: string;
  description?: string;
  // sequência esperada de transições (ex.: "pinch:start", "hand:lost"), usada pelos testes
  expectedEvents?: string[];
  frames: LandmarkSessionFrame[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLandmark(value: unknown): value is Landmark {
  return isRecord(value) && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
}

function parseFrame(value: unknown, index: number, previousMs: number): LandmarkSessionFrame {
  if (!isRecord(value) || typeof value.tMs !== 'number' || value.tMs < previousMs) {
    throw new TypeError(`frame ${index}: tMs must be a non-decreasing number`);
  }
  const landmarks = value.landmarks;
  if (landmarks === null) return { tMs: value.tMs, landmarks: null };
  if (!Array.isArray(landmarks) || landmarks.length !== LANDMARK_COUNT) {
    throw new TypeError(`frame ${index}: landmarks must be null or ${LANDMARK_COUNT} points`);
  }
  if (!landmarks.every(isLandmark)) throw new TypeError(`frame ${index}: invalid landmark`);
  return { tMs: value.tMs, landmarks };
}

function parseExpectedEvents(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new TypeError('expectedEvents must be an array of strings');
  }
  return value;
}

export function parseLandmarkSession(input: unknown): LandmarkSession {
  if (!isRecord(input) || input.version !== LANDMARK_SESSION_VERSION) {
    throw new TypeError(`landmark session must have version ${LANDMARK_SESSION_VERSION}`);
  }
  if (typeof input.name !== 'string' || !Array.isArray(input.frames)) {
    throw new TypeError('landmark session needs a name and a frames array');
  }
  let previousMs = 0;
  const frames = input.frames.map((frame: unknown, index) => {
    const parsed = parseFrame(frame, index, previousMs);
    previousMs = parsed.tMs;
    return parsed;
  });
  const session: LandmarkSession = { version: LANDMARK_SESSION_VERSION, name: input.name, frames };
  if (typeof input.description === 'string') session.description = input.description;
  const expectedEvents = parseExpectedEvents(input.expectedEvents);
  if (expectedEvents) session.expectedEvents = expectedEvents;
  return session;
}
