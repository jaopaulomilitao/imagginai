import {
  DEBUG_QUERY_PARAM,
  DEFAULT_ENVIRONMENT_PRESET,
  ENVIRONMENT_PRESETS,
  ENVIRONMENT_QUERY_PARAM,
  FPS_SMOOTHING_ALPHA,
  type EnvironmentPreset,
  type ZoneMode,
} from './constants';

// interpreta parâmetros da url da zona sem acoplar componentes ao objeto global location
export interface ZoneRuntimeParams {
  readonly debug: boolean;
  readonly environment: EnvironmentPreset;
}

export interface DebugMetrics {
  readonly fps: number;
  readonly inferenceHz: number;
  readonly targetHz: number;
  readonly latencyMs: number;
  readonly mode: ZoneMode;
}

export function formatDebugText(metrics: DebugMetrics): string {
  const fpsText = metrics.fps > 0 ? metrics.fps.toFixed(0) : '--';
  const hzText = `${metrics.inferenceHz.toFixed(1)}/${metrics.targetHz.toFixed(0)} Hz`;
  const latText = metrics.latencyMs > 0 ? `${metrics.latencyMs.toFixed(0)} ms` : '-- ms';
  return `FPS: ${fpsText} | Hand: ${hzText} (${latText}) | Mode: ${metrics.mode}`;
}

export function isEnvironmentPreset(value: string | null): value is EnvironmentPreset {
  return value !== null && (ENVIRONMENT_PRESETS as readonly string[]).includes(value);
}

export function parseZoneParams(search: string): ZoneRuntimeParams {
  const params = new URLSearchParams(search);
  const rawDebug = params.get(DEBUG_QUERY_PARAM);
  const debug = rawDebug === '1' || rawDebug === 'true';
  const rawEnv = params.get(ENVIRONMENT_QUERY_PARAM);
  const environment = isEnvironmentPreset(rawEnv) ? rawEnv : DEFAULT_ENVIRONMENT_PRESET;
  return { debug, environment };
}

// calcula a média móvel exponencial da taxa de quadros por segundo para o overlay de depuração
export class FpsMeter {
  private smoothedFps = 0;

  constructor(private readonly alpha: number = FPS_SMOOTHING_ALPHA) {}

  get fps(): number {
    return this.smoothedFps;
  }

  recordFrame(deltaMs: number): number {
    if (!(deltaMs > 0) || !Number.isFinite(deltaMs)) {
      return this.smoothedFps;
    }
    const instantFps = 1000 / deltaMs;
    if (this.smoothedFps === 0) {
      this.smoothedFps = instantFps;
    } else {
      this.smoothedFps += (instantFps - this.smoothedFps) * this.alpha;
    }
    return this.smoothedFps;
  }

  reset(): void {
    this.smoothedFps = 0;
  }
}
