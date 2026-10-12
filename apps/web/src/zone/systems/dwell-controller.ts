import { DWELL_DURATION_MS, HANDLE_HOVER_REVEAL_MS } from '../config/constants';

export interface DwellStepResult<TTarget> {
  readonly target: TTarget | null;
  // progresso normalizado no intervalo [0, 1] para desenhar o anel no cursor
  readonly progress: number;
  readonly triggered: boolean;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// temporizador de olhar (800 ms) que dispara uma única vez por permanência sobre o alvo (seção 3.2)
export class DwellTimer<TTarget = string> {
  private currentTarget: TTarget | null = null;
  private elapsedMs = 0;
  private hasTriggered = false;

  constructor(private readonly durationMs: number = DWELL_DURATION_MS) {
    if (durationMs <= 0 || !Number.isFinite(durationMs)) {
      throw new RangeError('dwell durationMs must be a positive finite number');
    }
  }

  get target(): TTarget | null {
    return this.currentTarget;
  }

  get progress(): number {
    if (this.currentTarget === null || this.hasTriggered) return 0;
    return clampUnit(this.elapsedMs / this.durationMs);
  }

  setTarget(target: TTarget | null): void {
    if (target === this.currentTarget) return;
    this.currentTarget = target;
    this.elapsedMs = 0;
    this.hasTriggered = false;
  }

  // reinicia a contagem sobre o mesmo alvo (ex.: após entrar no modo de arraste por dwell para permitir soltar com outro dwell)
  restartCurrentTarget(): void {
    this.elapsedMs = 0;
    this.hasTriggered = false;
  }

  reset(): void {
    this.currentTarget = null;
    this.elapsedMs = 0;
    this.hasTriggered = false;
  }

  step(deltaMs: number): DwellStepResult<TTarget> {
    if (
      this.currentTarget === null ||
      this.hasTriggered ||
      deltaMs <= 0 ||
      !Number.isFinite(deltaMs)
    ) {
      return {
        target: this.currentTarget,
        progress: this.progress,
        triggered: false,
      };
    }

    this.elapsedMs += deltaMs;
    if (this.elapsedMs >= this.durationMs) {
      this.hasTriggered = true;
      return {
        target: this.currentTarget,
        progress: 1,
        triggered: true,
      };
    }

    return {
      target: this.currentTarget,
      progress: clampUnit(this.elapsedMs / this.durationMs),
      triggered: false,
    };
  }
}

export type DragInputMode = 'idle' | 'grab' | 'dwell' | 'pinch';

// máquina de estados pura da alça de 6 pontos: revelação após 300 ms de hover e arraste por mão fechada (grab) ou dwell (seção 3.6.4)
export class DragHandleStateMachine {
  private hovered = false;
  private hoverElapsedMs = 0;
  private dragMode: DragInputMode = 'idle';

  constructor(private readonly hoverRevealMs: number = HANDLE_HOVER_REVEAL_MS) {
    if (hoverRevealMs <= 0 || !Number.isFinite(hoverRevealMs)) {
      throw new RangeError('hoverRevealMs must be a positive finite number');
    }
  }

  get isDragging(): boolean {
    return this.dragMode !== 'idle';
  }

  get mode(): DragInputMode {
    return this.dragMode;
  }

  // a alça aparece após 300 ms de hover no painel e permanece visível enquanto o arraste estiver ativo
  get isHandleVisible(): boolean {
    return this.isDragging || (this.hovered && this.hoverElapsedMs >= this.hoverRevealMs);
  }

  setPanelHovered(hovered: boolean): void {
    if (hovered === this.hovered) return;
    this.hovered = hovered;
    if (!hovered) {
      this.hoverElapsedMs = 0;
    }
  }

  stepHover(deltaMs: number): boolean {
    if (this.hovered && deltaMs > 0 && Number.isFinite(deltaMs)) {
      this.hoverElapsedMs = Math.min(this.hoverRevealMs, this.hoverElapsedMs + deltaMs);
    }
    return this.isHandleVisible;
  }

  startGrabDrag(): boolean {
    if (this.dragMode !== 'idle') return false;
    this.dragMode = 'grab';
    return true;
  }

  endGrabDrag(): boolean {
    if (this.dragMode !== 'grab') return false;
    this.dragMode = 'idle';
    return true;
  }

  startPinchDrag(): boolean {
    if (this.dragMode !== 'idle') return false;
    this.dragMode = 'pinch';
    return true;
  }

  endPinchDrag(): boolean {
    if (this.dragMode !== 'pinch' && this.dragMode !== 'grab') return false;
    this.dragMode = 'idle';
    return true;
  }

  // um dwell de 800 ms na alça inicia o arraste; um segundo dwell de 800 ms solta o painel
  toggleDwellDrag(): 'started' | 'dropped' | 'ignored' {
    if (this.dragMode === 'idle') {
      this.dragMode = 'dwell';
      return 'started';
    }
    if (this.dragMode === 'dwell') {
      this.dragMode = 'idle';
      return 'dropped';
    }
    return 'ignored';
  }

  cancel(): void {
    this.dragMode = 'idle';
  }
}
