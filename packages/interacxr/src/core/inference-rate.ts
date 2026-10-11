export interface InferenceRateConfig {
  // frequência com a mão presente (seção 3.8: 15–20 hz)
  activeHz: number;
  // frequência após um período sem mão detectada
  idleHz: number;
  idleAfterMs: number;
  // folga para não pular quadros por variação de poucos milissegundos no relógio
  jitterToleranceMs: number;
}

export const DEFAULT_INFERENCE_RATE: InferenceRateConfig = {
  activeHz: 20,
  idleHz: 5,
  idleAfterMs: 2000,
  jitterToleranceMs: 2,
};

// frequência do modo economia (seção 3.8)
export const ECONOMY_INFERENCE_HZ = 10;

const MS_PER_SECOND = 1000;

// decide quando um novo quadro deve ser enviado à inferência; lógica pura, sem e/s
export class InferenceRateController {
  private lastHandSeenMs: number;
  private lastProcessedMs = Number.NEGATIVE_INFINITY;
  private rateCapHz: number | null = null;

  constructor(
    startMs: number,
    private readonly config: InferenceRateConfig = DEFAULT_INFERENCE_RATE,
  ) {
    // o início conta como mão vista, para não começar já no modo ocioso
    this.lastHandSeenMs = startMs;
  }

  targetHz(nowMs: number): number {
    const idle = nowMs - this.lastHandSeenMs > this.config.idleAfterMs;
    const baseHz = idle ? this.config.idleHz : this.config.activeHz;
    return this.rateCapHz === null ? baseHz : Math.min(baseHz, this.rateCapHz);
  }

  shouldProcess(nowMs: number): boolean {
    const intervalMs = MS_PER_SECOND / this.targetHz(nowMs);
    return nowMs - this.lastProcessedMs >= intervalMs - this.config.jitterToleranceMs;
  }

  markProcessed(nowMs: number): void {
    this.lastProcessedMs = nowMs;
  }

  reportHand(present: boolean, nowMs: number): void {
    if (present) this.lastHandSeenMs = nowMs;
  }

  setRateCap(hz: number | null): void {
    this.rateCapHz = hz;
  }
}
