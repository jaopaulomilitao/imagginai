import { describe, expect, it } from 'vitest';

import { LandmarkSmoother, OneEuroFilter } from './filters';

const FRAME_MS = 50;

function noisy(base: number, frame: number): number {
  // ruído determinístico alternado de ±0,01
  return base + (frame % 2 === 0 ? 0.01 : -0.01);
}

describe('OneEuroFilter', () => {
  it('returns the first sample unchanged', () => {
    expect(new OneEuroFilter().filter(0.42, 0)).toBe(0.42);
  });

  it('attenuates jitter on a static signal', () => {
    const filter = new OneEuroFilter();
    const outputs: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      outputs.push(filter.filter(noisy(0.5, frame), frame * FRAME_MS));
    }
    const tail = outputs.slice(-10);
    const spread = Math.max(...tail) - Math.min(...tail);

    expect(spread).toBeLessThan(0.02 * 0.5);
  });

  it('follows a fast movement with little lag', () => {
    const filter = new OneEuroFilter();
    let output = 0;
    for (let frame = 0; frame <= 10; frame++) {
      output = filter.filter(frame * 0.05, frame * FRAME_MS);
    }

    expect(0.5 - output).toBeLessThan(0.1);
  });

  it('ignores repeated timestamps and restarts after reset', () => {
    const filter = new OneEuroFilter();
    filter.filter(0.1, 0);

    expect(filter.filter(0.9, 0)).toBe(0.1);
    filter.reset();
    expect(filter.filter(0.9, 100)).toBe(0.9);
  });
});

describe('LandmarkSmoother', () => {
  it('filters every coordinate of every landmark independently', () => {
    const smoother = new LandmarkSmoother();
    smoother.smooth(
      [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
      ],
      0,
    );

    const [first, second] = smoother.smooth(
      [
        { x: 0.1, y: 0, z: 0 },
        { x: 1, y: 1, z: 1 },
      ],
      50,
    );

    expect(first?.x).toBeGreaterThan(0);
    expect(first?.x).toBeLessThan(0.1);
    expect(second).toEqual({ x: 1, y: 1, z: 1 });
  });
});
