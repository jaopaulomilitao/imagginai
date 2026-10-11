export interface Scale3 {
  x: number;
  y: number;
  z: number;
}

export interface ScaleTarget {
  getScale(): Scale3;
  setScale(scale: Scale3): void;
}

export interface Timers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface PendingPress {
  original: Scale3;
  target: ScaleTarget;
  timer: unknown;
}

export const DEFAULT_PRESS_SCALE = 0.9;
export const DEFAULT_PRESS_DURATION_MS = 150;

const browserTimers: Timers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// pulso visual de clique: a escala original é copiada no início e restaurada exatamente ao fim,
// mesmo com cliques sobrepostos (antes a restauração reaplicava o valor já reduzido)
export class PressFeedback<K> {
  private readonly pending = new Map<K, PendingPress>();

  constructor(
    private readonly factor = DEFAULT_PRESS_SCALE,
    private readonly durationMs = DEFAULT_PRESS_DURATION_MS,
    private readonly timers: Timers = browserTimers,
  ) {}

  press(key: K, target: ScaleTarget, onDone?: () => void): void {
    const previous = this.pending.get(key);
    if (previous) this.timers.clearTimeout(previous.timer);
    const original = previous?.original ?? { ...target.getScale() };

    target.setScale({
      x: original.x * this.factor,
      y: original.y * this.factor,
      z: original.z * this.factor,
    });
    const timer = this.timers.setTimeout(() => {
      this.pending.delete(key);
      target.setScale(original);
      onDone?.();
    }, this.durationMs);
    this.pending.set(key, { original, target, timer });
  }

  // restaura imediatamente tudo o que estiver pressionado (usado ao remover o componente)
  restoreAll(): void {
    for (const { original, target, timer } of this.pending.values()) {
      this.timers.clearTimeout(timer);
      target.setScale(original);
    }
    this.pending.clear();
  }
}
