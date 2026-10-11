import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { syntheticHand } from '../testing/synthetic-hand';
import { parseLandmarkSession } from './landmark-session';
import { ReplayPlayer } from './replay-player';
import { ReplayRecorder } from './replay-recorder';

describe('ReplayRecorder', () => {
  it('records relative timestamps and rounds coordinates', () => {
    const recorder = new ReplayRecorder();
    recorder.start();
    recorder.record(syntheticHand({ offsetX: 0.123456789 }), 1000);
    recorder.record(null, 1050);

    const session = recorder.stop('demo');

    expect(session.frames.map((frame) => frame.tMs)).toEqual([0, 50]);
    expect(session.frames[0]?.landmarks?.[0]?.x).toBe(0.6235);
    expect(session.frames[1]?.landmarks).toBeNull();
    expect(recorder.isRecording).toBe(false);
  });

  it('ignores frames while not recording', () => {
    const recorder = new ReplayRecorder();
    recorder.record(syntheticHand(), 0);

    expect(recorder.stop('empty').frames).toEqual([]);
  });

  it('produces sessions that round-trip through JSON and the parser', () => {
    const recorder = new ReplayRecorder();
    recorder.start();
    recorder.record(syntheticHand(), 0);

    const session = recorder.stop('round-trip', 'one open hand');
    const parsed = parseLandmarkSession(JSON.parse(JSON.stringify(session)));

    expect(parsed).toEqual(session);
  });
});

describe('parseLandmarkSession', () => {
  it.each([
    ['wrong version', { version: 2, name: 'x', frames: [] }],
    ['missing frames', { version: 1, name: 'x' }],
    [
      'short hand',
      { version: 1, name: 'x', frames: [{ tMs: 0, landmarks: [{ x: 0, y: 0, z: 0 }] }] },
    ],
    [
      'time going backwards',
      {
        version: 1,
        name: 'x',
        frames: [
          { tMs: 10, landmarks: null },
          { tMs: 5, landmarks: null },
        ],
      },
    ],
  ])('rejects %s', (_label, input) => {
    expect(() => parseLandmarkSession(input)).toThrow(TypeError);
  });
});

describe('ReplayPlayer', () => {
  const session = parseLandmarkSession({
    version: 1,
    name: 'two-frames',
    frames: [
      { tMs: 0, landmarks: null },
      { tMs: 100, landmarks: syntheticHand() },
    ],
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('replays every frame synchronously with shifted timestamps', () => {
    const timestamps: number[] = [];

    new ReplayPlayer(session).playAll((_hand, t) => timestamps.push(t), 500);

    expect(timestamps).toEqual([500, 600]);
  });

  it('replays in real time and resolves when finished', async () => {
    const handler = vi.fn();
    const playback = new ReplayPlayer(session).play(handler, () => 0);

    vi.advanceTimersByTime(50);
    expect(handler).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(50);
    await playback.finished;

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('stops pending frames', () => {
    const handler = vi.fn();
    const playback = new ReplayPlayer(session).play(handler, () => 0);

    playback.stop();
    vi.advanceTimersByTime(200);

    expect(handler).not.toHaveBeenCalled();
  });
});
