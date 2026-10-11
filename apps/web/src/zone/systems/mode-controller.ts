import { DEFAULT_ZONE_MODE, MODE_TRANSITION_DURATION_MS, type ZoneMode } from '../config/constants';

export interface ModeSnapshot {
  readonly mode: ZoneMode;
  readonly targetMode: ZoneMode;
  readonly transitioning: boolean;
  // opacidade do plano de vídeo da câmera traseira (0 = oculto no foco, 1 = passthrough completo)
  readonly passthroughOpacity: number;
  // opacidade do céu e do ambiente virtual (1 = visível no foco, 0 = oculto no passthrough)
  readonly environmentOpacity: number;
  // o céu só fica invisível quando a opacidade do ambiente chega a zero, evitando clarões
  readonly environmentVisible: boolean;
}

export type ModeChangeListener = (snapshot: ModeSnapshot) => void;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function targetPassthroughOpacity(mode: ZoneMode): number {
  return mode === 'passthrough' ? 1 : 0;
}

// máquina de estados pura que controla a alternância entre foco e passthrough com fade de 300 ms
export class ModeController {
  private currentMode: ZoneMode;
  private target: ZoneMode;
  private passthroughAlpha: number;
  private startAlpha: number;
  private elapsedMs = 0;
  private inTransition = false;
  private readonly durationMs: number;
  private readonly listeners = new Set<ModeChangeListener>();

  constructor(
    initialMode: ZoneMode = DEFAULT_ZONE_MODE,
    durationMs: number = MODE_TRANSITION_DURATION_MS,
  ) {
    if (durationMs <= 0 || !Number.isFinite(durationMs)) {
      throw new RangeError('transition durationMs must be a positive finite number');
    }
    this.currentMode = initialMode;
    this.target = initialMode;
    this.passthroughAlpha = targetPassthroughOpacity(initialMode);
    this.startAlpha = this.passthroughAlpha;
    this.durationMs = durationMs;
  }

  get mode(): ZoneMode {
    return this.currentMode;
  }

  get targetMode(): ZoneMode {
    return this.target;
  }

  get snapshot(): ModeSnapshot {
    const passthroughOpacity = clampUnit(this.passthroughAlpha);
    const environmentOpacity = clampUnit(1 - passthroughOpacity);
    return {
      mode: this.currentMode,
      targetMode: this.target,
      transitioning: this.inTransition,
      passthroughOpacity,
      environmentOpacity,
      environmentVisible: environmentOpacity > 0,
    };
  }

  subscribe(listener: ModeChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  toggle(): ModeSnapshot {
    const next: ZoneMode = this.target === 'focus' ? 'passthrough' : 'focus';
    return this.setMode(next);
  }

  setMode(nextMode: ZoneMode): ModeSnapshot {
    if (nextMode === this.target && !this.inTransition) {
      return this.snapshot;
    }
    if (nextMode === this.target) {
      return this.snapshot;
    }
    this.target = nextMode;
    this.startAlpha = this.passthroughAlpha;
    this.elapsedMs = 0;
    this.inTransition = this.passthroughAlpha !== targetPassthroughOpacity(nextMode);
    if (!this.inTransition) {
      this.currentMode = nextMode;
    }
    return this.emit();
  }

  // avança a interpolação linear sem saltos mesmo se o modo for invertido no meio da transição
  step(deltaMs: number): ModeSnapshot {
    if (!this.inTransition || deltaMs <= 0 || !Number.isFinite(deltaMs)) {
      return this.snapshot;
    }
    const goalAlpha = targetPassthroughOpacity(this.target);
    const distance = Math.abs(goalAlpha - this.startAlpha);
    const effectiveDuration = Math.max(1, this.durationMs * distance);
    this.elapsedMs += deltaMs;

    if (this.elapsedMs >= effectiveDuration) {
      this.passthroughAlpha = goalAlpha;
      this.currentMode = this.target;
      this.inTransition = false;
      return this.emit();
    }

    const progress = clampUnit(this.elapsedMs / effectiveDuration);
    this.passthroughAlpha = this.startAlpha + (goalAlpha - this.startAlpha) * progress;
    return this.emit();
  }

  private emit(): ModeSnapshot {
    const current = this.snapshot;
    this.listeners.forEach((listener) => listener(current));
    return current;
  }
}
