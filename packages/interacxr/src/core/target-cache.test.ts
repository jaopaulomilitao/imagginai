import { describe, expect, it, vi } from 'vitest';

import { type ObserverFactory, TargetCache } from './target-cache';

function setup() {
  let notify: () => void = () => undefined;
  const disconnect = vi.fn();
  const observe: ObserverFactory = (onChange) => {
    notify = onChange;
    return { disconnect };
  };
  const query = vi.fn(() => ['a', 'b']);
  const cache = new TargetCache(query, observe);
  return { cache, query, disconnect, mutate: () => notify() };
}

describe('TargetCache', () => {
  it('queries the scene once and reuses the list across frames', () => {
    const { cache, query } = setup();

    for (let frame = 0; frame < 60; frame++) cache.get();

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('refreshes the list after a DOM mutation', () => {
    const { cache, query, mutate } = setup();
    cache.get();

    mutate();
    cache.get();
    cache.get();

    expect(query).toHaveBeenCalledTimes(2);
  });

  it('disconnects the observer on dispose', () => {
    const { cache, disconnect } = setup();

    cache.dispose();

    expect(disconnect).toHaveBeenCalledOnce();
  });
});
