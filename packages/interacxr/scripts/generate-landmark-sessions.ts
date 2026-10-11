// gera as sessões sintéticas de fixtures/landmark-sessions (determinísticas, com ruído semeado)
// uso: node packages/interacxr/scripts/generate-landmark-sessions.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FIST,
  type FingerState,
  OPEN_HAND,
  POINTING,
  syntheticHand,
  VICTORY,
} from '../src/testing/synthetic-hand.ts';

interface Segment {
  frames: number;
  fingers?: FingerState;
  pinchRatio?: number;
  // deslocamento horizontal total ao longo do segmento (arraste)
  driftX?: number;
  // segmento sem mão detectada
  absent?: boolean;
}

interface SessionSpec {
  name: string;
  description: string;
  expectedEvents: string[];
  segments: Segment[];
}

const FRAME_MS = 50;
const JITTER_MS = 4;
const NOISE = 0.003;
const DECIMALS = 10_000;
const OUTPUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/landmark-sessions',
);

// gerador congruencial linear: o mesmo resultado em qualquer máquina
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

function round(value: number): number {
  return Math.round(value * DECIMALS) / DECIMALS;
}

function buildFrames(segments: Segment[], seed: number) {
  const random = createRandom(seed);
  const frames: { tMs: number; landmarks: { x: number; y: number; z: number }[] | null }[] = [];
  let index = 0;
  for (const segment of segments) {
    for (let i = 0; i < segment.frames; i++, index++) {
      const tMs = index * FRAME_MS + Math.round((random() - 0.5) * 2 * JITTER_MS);
      if (segment.absent) {
        frames.push({ tMs: Math.max(0, tMs), landmarks: null });
        continue;
      }
      const offsetX = ((segment.driftX ?? 0) * i) / segment.frames;
      const hand = syntheticHand({
        fingers: segment.fingers ?? OPEN_HAND,
        pinchRatio: segment.pinchRatio ?? 1,
        offsetX,
      }).map((point) => ({
        x: round(point.x + (random() - 0.5) * 2 * NOISE),
        y: round(point.y + (random() - 0.5) * 2 * NOISE),
        z: round(point.z + (random() - 0.5) * 2 * NOISE),
      }));
      frames.push({ tMs: Math.max(0, tMs), landmarks: hand });
    }
  }
  return frames;
}

const SESSIONS: SessionSpec[] = [
  {
    name: 'pinch-tap',
    description: 'open hand, short pinch (select), open hand',
    expectedEvents: ['pinch:start', 'pinch:end'],
    segments: [
      { frames: 8, pinchRatio: 1 },
      { frames: 8, pinchRatio: 0.1 },
      { frames: 8, pinchRatio: 1 },
    ],
  },
  {
    name: 'pinch-drag-with-dropout',
    description: 'pinch held while dragging right, 2-frame tracking dropout, release, hand leaves',
    expectedEvents: ['pinch:start', 'pinch:end', 'hand:lost'],
    segments: [
      { frames: 6, pinchRatio: 1 },
      { frames: 10, pinchRatio: 0.1, driftX: 0.1 },
      { frames: 2, absent: true },
      { frames: 10, pinchRatio: 0.1 },
      { frames: 8, pinchRatio: 1 },
      { frames: 6, absent: true },
    ],
  },
  {
    name: 'pose-sequence',
    description: 'point, victory, fist, open hand (thumb away from index: no pinch)',
    expectedEvents: [
      'point:start',
      'victory:start',
      'point:end',
      'grab:start',
      'victory:end',
      'grab:end',
    ],
    segments: [
      { frames: 10, fingers: POINTING },
      { frames: 10, fingers: VICTORY },
      { frames: 10, fingers: FIST },
      { frames: 10, fingers: OPEN_HAND },
    ],
  },
];

mkdirSync(OUTPUT_DIR, { recursive: true });
SESSIONS.forEach((spec, index) => {
  const session = {
    version: 1,
    name: spec.name,
    description: spec.description,
    expectedEvents: spec.expectedEvents,
    frames: buildFrames(spec.segments, index + 1),
  };
  writeFileSync(join(OUTPUT_DIR, `${spec.name}.json`), `${JSON.stringify(session)}\n`);
  process.stdout.write(`wrote ${spec.name}.json (${session.frames.length} frames)\n`);
});
