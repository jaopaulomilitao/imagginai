import { describe, expect, it } from 'vitest';

import { FIST, OPEN_HAND, POINTING, ROCK, syntheticHand, VICTORY } from '../testing/synthetic-hand';
import type { HandLandmarks } from './landmarks';
import {
  classifyFrame,
  DEFAULT_POSE_CLASSIFIER_CONFIG,
  measureHand,
  type PoseEvent,
  PoseClassifier,
} from './pose-classifier';

const FRAME_MS = 50;
const NO_SMOOTHING = { ...DEFAULT_POSE_CLASSIFIER_CONFIG, smoothing: null };

function feed(classifier: PoseClassifier, frames: (HandLandmarks | null)[], startMs = 0) {
  return frames.map((hand, i) => classifier.update(hand, startMs + i * FRAME_MS));
}

function starts(events: PoseEvent[]): string[] {
  return events.filter((event) => event.phase === 'start').map((event) => event.pose);
}

describe('classifyFrame', () => {
  it.each([
    ['grab', FIST],
    ['victory', VICTORY],
    ['point', POINTING],
    ['rock', ROCK],
  ] as const)('recognizes %s', (pose, fingers) => {
    expect(classifyFrame(syntheticHand({ fingers }), false)[pose]).toBe(true);
  });

  it('measures hand size from the wrist to landmark 9', () => {
    expect(measureHand(syntheticHand()).handSize).toBeCloseTo(0.15, 10);
  });

  it('normalizes the pinch threshold by hand size', () => {
    const near = syntheticHand({ pinchRatio: 0.2, scale: 2 });
    const far = syntheticHand({ pinchRatio: 0.2, scale: 0.5 });

    expect(classifyFrame(near, false).pinch).toBe(true);
    expect(classifyFrame(far, false).pinch).toBe(true);
    // 0,039 de distância absoluta numa mão distante: o limiar fixo original (0,04) acusaria pinça
    const farOpen = syntheticHand({ pinchRatio: 0.52, scale: 0.5 });
    expect(classifyFrame(farOpen, false).pinch).toBe(false);
  });

  it('applies hysteresis between start and end ratios', () => {
    const between = syntheticHand({ pinchRatio: 0.3 });

    expect(classifyFrame(between, false).pinch).toBe(false);
    expect(classifyFrame(between, true).pinch).toBe(true);
  });

  it('blocks pinch while making a fist', () => {
    expect(classifyFrame(syntheticHand({ fingers: FIST, pinchRatio: 0 }), false).pinch).toBe(false);
  });
});

describe('PoseClassifier', () => {
  it('confirms a pose only after 3 consecutive frames', () => {
    const classifier = new PoseClassifier(NO_SMOOTHING);
    const pinch = syntheticHand({ pinchRatio: 0.1 });

    const updates = feed(classifier, [pinch, pinch, pinch]);

    expect(starts(updates[0]?.events ?? [])).toEqual([]);
    expect(starts(updates[1]?.events ?? [])).toEqual([]);
    expect(starts(updates[2]?.events ?? [])).toContain('pinch');
  });

  it('ignores a single-frame glitch', () => {
    const classifier = new PoseClassifier(NO_SMOOTHING);
    const open = syntheticHand({ pinchRatio: 1 });
    const pinch = syntheticHand({ pinchRatio: 0.1 });

    const updates = feed(classifier, [open, pinch, open, open]);

    expect(updates.flatMap((update) => starts(update.events))).not.toContain('pinch');
  });

  it('emits move while held and end after release is confirmed', () => {
    const classifier = new PoseClassifier(NO_SMOOTHING);
    const pinch = syntheticHand({ pinchRatio: 0.1 });
    const open = syntheticHand({ pinchRatio: 1 });

    const updates = feed(classifier, [pinch, pinch, pinch, pinch, open, open, open]);
    const pinchPhases = updates.map(
      (update) => update.events.find((event) => event.pose === 'pinch')?.phase ?? null,
    );

    expect(pinchPhases).toEqual([null, null, 'start', 'move', 'move', 'move', 'end']);
  });

  it('keeps a pinch through a 2-frame tracking dropout and ends it after 3', () => {
    const classifier = new PoseClassifier(NO_SMOOTHING);
    const pinch = syntheticHand({ pinchRatio: 0.1 });

    feed(classifier, [pinch, pinch, pinch]);
    const dropout = feed(classifier, [null, null, pinch], 150);
    expect(classifier.isActive('pinch')).toBe(true);
    expect(dropout.some((update) => update.handLost)).toBe(false);

    const lost = feed(classifier, [null, null, null], 300);
    expect(classifier.isActive('pinch')).toBe(false);
    expect(lost.at(-1)?.handLost).toBe(true);
  });

  it('smooths landmarks with the One Euro filter by default', () => {
    const classifier = new PoseClassifier();
    classifier.update(syntheticHand(), 0);

    const update = classifier.update(syntheticHand({ offsetX: 0.1 }), FRAME_MS);
    const wristX = update.landmarks?.[0]?.x ?? 0;

    expect(wristX).toBeGreaterThan(0.5);
    expect(wristX).toBeLessThan(0.6);
  });

  it('opens with an open hand producing no poses', () => {
    const classifier = new PoseClassifier(NO_SMOOTHING);
    const open = syntheticHand({ fingers: OPEN_HAND });

    const updates = feed(classifier, [open, open, open, open]);

    expect(updates.flatMap((update) => update.events)).toEqual([]);
  });
});
