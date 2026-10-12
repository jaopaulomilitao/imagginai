import {
  DEFAULT_POMODORO_PRESET,
  POMODORO_BREAK_5_MS,
  POMODORO_FOCUS_20_MS,
  POMODORO_FOCUS_25_MS,
  POMODORO_WARNING_BEFORE_END_MS,
  type PomodoroPreset,
} from '../config/constants';

export type PomodoroPhase = 'idle' | 'focus' | 'paused' | 'break';

export interface PomodoroSnapshot {
  readonly preset: PomodoroPreset;
  readonly phase: PomodoroPhase;
  readonly remainingMs: number;
  readonly totalPhaseMs: number;
  readonly completedBlocks: number;
  readonly oneMinuteWarningActive: boolean;
}

export interface PomodoroStepEvents {
  readonly snapshot: PomodoroSnapshot;
  readonly warningJustTriggered: boolean;
  readonly breakJustStarted: boolean;
  readonly breakJustEnded: boolean;
}

export function getFocusDurationMs(preset: PomodoroPreset): number {
  return preset === '20/5' ? POMODORO_FOCUS_20_MS : POMODORO_FOCUS_25_MS;
}

export function formatPomodoroMmSs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// gerencia o ciclo pomodoro (25/5 ou 20/5), aviso de 1 minuto e transição para tela de pausa
export class PomodoroSystem {
  private preset: PomodoroPreset;
  private phase: PomodoroPhase = 'idle';
  private remainingMs: number;
  private totalPhaseMs: number;
  private completedBlocks = 0;
  private oneMinuteWarningFired = false;
  private readonly listeners = new Set<(events: PomodoroStepEvents) => void>();

  constructor(
    preset: PomodoroPreset = DEFAULT_POMODORO_PRESET,
    private readonly breakDurationMs = POMODORO_BREAK_5_MS,
    private readonly warningBeforeEndMs = POMODORO_WARNING_BEFORE_END_MS,
  ) {
    this.preset = preset;
    this.totalPhaseMs = getFocusDurationMs(preset);
    this.remainingMs = this.totalPhaseMs;
  }

  get snapshot(): PomodoroSnapshot {
    return {
      preset: this.preset,
      phase: this.phase,
      remainingMs: this.remainingMs,
      totalPhaseMs: this.totalPhaseMs,
      completedBlocks: this.completedBlocks,
      oneMinuteWarningActive:
        (this.phase === 'focus' || this.phase === 'paused') &&
        this.oneMinuteWarningFired &&
        this.remainingMs > 0,
    };
  }

  subscribe(listener: (events: PomodoroStepEvents) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setPreset(preset: PomodoroPreset): PomodoroSnapshot {
    this.preset = preset;
    if (this.phase === 'idle') {
      this.totalPhaseMs = getFocusDurationMs(preset);
      this.remainingMs = this.totalPhaseMs;
      this.oneMinuteWarningFired = false;
    }
    const snap = this.snapshot;
    this.emit({
      snapshot: snap,
      warningJustTriggered: false,
      breakJustStarted: false,
      breakJustEnded: false,
    });
    return snap;
  }

  toggle(): PomodoroSnapshot {
    if (this.phase === 'idle' || this.phase === 'break') {
      return this.startFocus();
    }
    if (this.phase === 'focus') {
      this.phase = 'paused';
    } else if (this.phase === 'paused') {
      this.phase = 'focus';
    }
    const snap = this.snapshot;
    this.emit({
      snapshot: snap,
      warningJustTriggered: false,
      breakJustStarted: false,
      breakJustEnded: false,
    });
    return snap;
  }

  startFocus(): PomodoroSnapshot {
    this.phase = 'focus';
    this.totalPhaseMs = getFocusDurationMs(this.preset);
    this.remainingMs = this.totalPhaseMs;
    this.oneMinuteWarningFired = false;
    const snap = this.snapshot;
    this.emit({
      snapshot: snap,
      warningJustTriggered: false,
      breakJustStarted: false,
      breakJustEnded: false,
    });
    return snap;
  }

  skipBreak(): PomodoroSnapshot {
    return this.startFocus();
  }

  reset(): PomodoroSnapshot {
    this.phase = 'idle';
    this.totalPhaseMs = getFocusDurationMs(this.preset);
    this.remainingMs = this.totalPhaseMs;
    this.oneMinuteWarningFired = false;
    const snap = this.snapshot;
    this.emit({
      snapshot: snap,
      warningJustTriggered: false,
      breakJustStarted: false,
      breakJustEnded: false,
    });
    return snap;
  }

  step(deltaMs: number): PomodoroStepEvents {
    const dt = Math.max(0, deltaMs);
    let warningJustTriggered = false;
    let breakJustStarted = false;
    let breakJustEnded = false;

    if (this.phase === 'focus' && dt > 0) {
      this.remainingMs = Math.max(0, this.remainingMs - dt);

      if (
        !this.oneMinuteWarningFired &&
        this.remainingMs > 0 &&
        this.remainingMs <= this.warningBeforeEndMs
      ) {
        this.oneMinuteWarningFired = true;
        warningJustTriggered = true;
      }

      if (this.remainingMs === 0) {
        this.completedBlocks += 1;
        this.phase = 'break';
        this.totalPhaseMs = this.breakDurationMs;
        this.remainingMs = this.breakDurationMs;
        this.oneMinuteWarningFired = false;
        breakJustStarted = true;
      }
    } else if (this.phase === 'break' && dt > 0) {
      this.remainingMs = Math.max(0, this.remainingMs - dt);
      if (this.remainingMs === 0) {
        this.phase = 'idle';
        this.totalPhaseMs = getFocusDurationMs(this.preset);
        this.remainingMs = this.totalPhaseMs;
        breakJustEnded = true;
      }
    }

    const events: PomodoroStepEvents = {
      snapshot: this.snapshot,
      warningJustTriggered,
      breakJustStarted,
      breakJustEnded,
    };

    if (warningJustTriggered || breakJustStarted || breakJustEnded) {
      this.emit(events);
    }
    return events;
  }

  private emit(events: PomodoroStepEvents): void {
    this.listeners.forEach((listener) => listener(events));
  }
}
