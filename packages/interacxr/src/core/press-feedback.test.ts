import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PressFeedback, type Scale3, type ScaleTarget } from './press-feedback';

function createTarget(initial: Scale3): ScaleTarget & { current: Scale3 } {
  // o getter devolve uma referência viva, como object3D.scale no three
  const state = { current: { ...initial } };
  return {
    get current() {
      return state.current;
    },
    getScale: () => state.current,
    setScale: (scale) => {
      Object.assign(state.current, scale);
    },
  };
}

describe('PressFeedback', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shrinks during the press and restores the exact original scale', () => {
    const feedback = new PressFeedback<string>();
    const target = createTarget({ x: 0.2, y: 0.1, z: 0.2 });

    feedback.press('button', target);
    expect(target.current.x).toBeCloseTo(0.18, 10);

    vi.advanceTimersByTime(150);
    expect(target.current).toEqual({ x: 0.2, y: 0.1, z: 0.2 });
  });

  it('does not accumulate shrinking across repeated presses', () => {
    const feedback = new PressFeedback<string>();
    const target = createTarget({ x: 1, y: 1, z: 1 });

    feedback.press('button', target);
    vi.advanceTimersByTime(50);
    feedback.press('button', target);
    expect(target.current.x).toBeCloseTo(0.9, 10);

    vi.advanceTimersByTime(150);
    expect(target.current).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('calls onDone once the pulse ends', () => {
    const feedback = new PressFeedback<string>();
    const onDone = vi.fn();

    feedback.press('button', createTarget({ x: 1, y: 1, z: 1 }), onDone);
    vi.advanceTimersByTime(150);

    expect(onDone).toHaveBeenCalledOnce();
  });

  it('restores pending presses immediately on restoreAll', () => {
    const feedback = new PressFeedback<string>();
    const target = createTarget({ x: 2, y: 2, z: 2 });
    feedback.press('button', target);

    feedback.restoreAll();

    expect(target.current).toEqual({ x: 2, y: 2, z: 2 });
  });
});
