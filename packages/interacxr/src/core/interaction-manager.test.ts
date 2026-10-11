import { describe, expect, it } from 'vitest';

import { type InteractionState, InteractionManager } from './interaction-manager';

describe('InteractionManager', () => {
  it('grants a mode only while idle', () => {
    const manager = new InteractionManager();
    const owner = {};

    expect(manager.request('grab', owner)).toBe(true);
    expect(manager.request('teleport', {})).toBe(false);
    expect(manager.isActive('grab')).toBe(true);
  });

  it('ignores release from a non-owner', () => {
    const manager = new InteractionManager();
    manager.request('grab', { name: 'owner' });

    manager.release({ name: 'intruder' });

    expect(manager.getMode()).toBe('grab');
  });

  it('notifies subscribers on every state change', () => {
    const manager = new InteractionManager();
    const states: InteractionState[] = [];
    const owner = {};
    manager.subscribe((state) => states.push(state));

    manager.request('interact', owner);
    manager.release(owner);

    expect(states.map((state) => state.mode)).toEqual(['interact', 'idle']);
    expect(manager.isIdle()).toBe(true);
  });
});
