import type { HandLandmarks } from '../core/landmarks';
import type { LandmarkSession } from './landmark-session';

export type ReplayHandler = (landmarks: HandLandmarks | null, timestampMs: number) => void;

export interface ReplayScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ReplayPlayback {
  stop(): void;
  readonly finished: Promise<void>;
}

const browserScheduler: ReplayScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// reproduz uma sessão gravada como se viesse do rastreador (testes, depuração e demonstrações)
export class ReplayPlayer {
  constructor(private readonly session: LandmarkSession) {}

  get durationMs(): number {
    return this.session.frames.at(-1)?.tMs ?? 0;
  }

  // reprodução síncrona, com os carimbos de tempo originais deslocados por startMs
  playAll(handler: ReplayHandler, startMs = 0): void {
    for (const frame of this.session.frames) handler(frame.landmarks, startMs + frame.tMs);
  }

  // reprodução em tempo real, respeitando os intervalos gravados
  play(
    handler: ReplayHandler,
    now: () => number = () => performance.now(),
    scheduler: ReplayScheduler = browserScheduler,
  ): ReplayPlayback {
    const startMs = now();
    const handles: unknown[] = [];
    let resolveFinished: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => (resolveFinished = resolve));

    this.session.frames.forEach((frame, index) => {
      const isLast = index === this.session.frames.length - 1;
      const handle = scheduler.setTimeout(() => {
        handler(frame.landmarks, startMs + frame.tMs);
        if (isLast) resolveFinished();
      }, frame.tMs);
      handles.push(handle);
    });
    if (this.session.frames.length === 0) resolveFinished();

    return {
      finished,
      stop: () => {
        handles.forEach((handle) => scheduler.clearTimeout(handle));
        resolveFinished();
      },
    };
  }
}
