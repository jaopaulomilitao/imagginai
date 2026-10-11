import { describe, expect, it, vi } from 'vitest';

import { type AnyTelemetryRecord, TelemetryBus } from './telemetry-bus';

type TestEvents = {
  'gesture.pinch.success': { targetId: string };
  'perf.window': { fpsP50: number; fpsP10: number };
};

describe('TelemetryBus', () => {
  it('delivers typed records with a monotonic timestamp', () => {
    const bus = new TelemetryBus<TestEvents>(() => 1234);
    const listener = vi.fn();
    bus.on('gesture.pinch.success', listener);

    bus.emit('gesture.pinch.success', { targetId: 'card-1' });

    expect(listener).toHaveBeenCalledWith({
      type: 'gesture.pinch.success',
      tMonoMs: 1234,
      payload: { targetId: 'card-1' },
    });
  });

  it('only notifies listeners of the matching type, plus wildcard listeners', () => {
    const bus = new TelemetryBus<TestEvents>(() => 0);
    const pinch = vi.fn();
    const all: AnyTelemetryRecord<TestEvents>[] = [];
    bus.on('gesture.pinch.success', pinch);
    bus.onAny((record) => all.push(record));

    bus.emit('perf.window', { fpsP50: 58, fpsP10: 51 });

    expect(pinch).not.toHaveBeenCalled();
    expect(all.map((record) => record.type)).toEqual(['perf.window']);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new TelemetryBus<TestEvents>(() => 0);
    const listener = vi.fn();
    const unsubscribe = bus.on('perf.window', listener);

    unsubscribe();
    bus.emit('perf.window', { fpsP50: 60, fpsP10: 55 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates a failing listener from the others', () => {
    const bus = new TelemetryBus<TestEvents>(() => 0);
    const healthy = vi.fn();
    bus.onAny(() => {
      throw new Error('boom');
    });
    bus.onAny(healthy);

    bus.emit('perf.window', { fpsP50: 60, fpsP10: 55 });

    expect(healthy).toHaveBeenCalledOnce();
  });
});
