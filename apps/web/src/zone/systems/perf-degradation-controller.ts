import { computePercentile } from './telemetry-aggregator';

export const PERF_WINDOW_DURATION_MS = 10_000;
export const PERF_MIN_SUSTAINED_FPS = 50;
export const PERF_LATENCY_DEGRADATION_FACTOR = 1.4;
export const ECONOMY_MODE_TARGET_HZ = 10;

export interface PerfWindowReport {
  readonly fpsP50: number;
  readonly fpsP10: number;
  readonly meanLatencyMs: number;
  readonly economyModeActive: boolean;
  readonly economyJustTriggered: boolean;
}

// monitora janelas de 10 s de fps e latência de inferência para acionar o modo econômico de 10 hz (seção 3.8)
export class PerfDegradationController {
  private windowElapsedMs = 0;
  private lowFpsSustainedMs = 0;
  private initialMeanLatencyMs: number | null = null;
  private economyModeActive = false;
  private readonly fpsSamples: number[] = [];
  private readonly latencySamples: number[] = [];

  isEconomyModeActive(): boolean {
    return this.economyModeActive;
  }

  getInitialMeanLatencyMs(): number | null {
    return this.initialMeanLatencyMs;
  }

  recordSample(
    deltaMs: number,
    currentFps: number,
    inferenceLatencyMs?: number,
  ): PerfWindowReport | null {
    const dt = Math.max(0, deltaMs);
    if (dt === 0) return null;

    this.windowElapsedMs += dt;
    if (currentFps > 0) {
      this.fpsSamples.push(currentFps);
      if (currentFps < PERF_MIN_SUSTAINED_FPS) {
        this.lowFpsSustainedMs += dt;
      } else {
        this.lowFpsSustainedMs = 0;
      }
    }

    if (typeof inferenceLatencyMs === 'number' && inferenceLatencyMs > 0) {
      this.latencySamples.push(inferenceLatencyMs);
    }

    if (this.windowElapsedMs < PERF_WINDOW_DURATION_MS) {
      return null;
    }

    const fpsP50 = this.fpsSamples.length > 0 ? computePercentile(this.fpsSamples, 50) : 60;
    const fpsP10 = this.fpsSamples.length > 0 ? computePercentile(this.fpsSamples, 10) : 55;
    const meanLatencyMs =
      this.latencySamples.length > 0
        ? Math.round(
            (this.latencySamples.reduce((acc, v) => acc + v, 0) / this.latencySamples.length) * 10,
          ) / 10
        : 0;

    if (this.initialMeanLatencyMs === null && meanLatencyMs > 0) {
      this.initialMeanLatencyMs = meanLatencyMs;
    }

    const latencyDegraded =
      this.initialMeanLatencyMs !== null &&
      meanLatencyMs > this.initialMeanLatencyMs * PERF_LATENCY_DEGRADATION_FACTOR;
    const fpsDegraded = this.lowFpsSustainedMs >= PERF_WINDOW_DURATION_MS;

    let economyJustTriggered = false;
    if (!this.economyModeActive && (fpsDegraded || latencyDegraded)) {
      this.economyModeActive = true;
      economyJustTriggered = true;
    }

    this.windowElapsedMs = 0;
    this.fpsSamples.length = 0;
    this.latencySamples.length = 0;

    return {
      fpsP50,
      fpsP10,
      meanLatencyMs,
      economyModeActive: this.economyModeActive,
      economyJustTriggered,
    };
  }
}
