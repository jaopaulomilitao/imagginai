// formato de ponto normalizado devolvido pelo mediapipe hand landmarker (x, y em [0, 1])
export interface Landmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type HandLandmarks = readonly Landmark[];

export const LANDMARK_COUNT = 21;

export const LANDMARK = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_PIP: 6,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_TIP: 12,
  RING_PIP: 14,
  RING_TIP: 16,
  PINKY_PIP: 18,
  PINKY_TIP: 20,
} as const;

export interface TrackedHand {
  readonly landmarks: HandLandmarks;
  readonly handedness: 'left' | 'right';
  readonly score: number;
}

export interface HandDataDetail {
  landmarks: HandLandmarks | null;
  hands?: readonly TrackedHand[];
  // instante de captura do quadro (performance.now), usado pelos filtros temporais
  timestampMs: number;
}
