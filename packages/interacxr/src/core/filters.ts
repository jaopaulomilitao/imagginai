import type { HandLandmarks, Landmark } from './landmarks';

export interface OneEuroParams {
  // frequência de corte mínima (hz): menor valor reduz o tremor com a mão parada
  minCutoff: number;
  // ganho de velocidade: maior valor reduz o atraso em movimentos rápidos
  beta: number;
  // frequência de corte aplicada à derivada (hz)
  dCutoff: number;
}

// ajustado para coordenadas normalizadas [0, 1] a 15–20 hz; refinar no dispositivo
export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.0, beta: 10, dCutoff: 1.0 };

const MS_PER_SECOND = 1000;

function smoothingFactor(dtSeconds: number, cutoffHz: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

// filtro one euro (casiez, roussel e vogel, chi 2012)
export class OneEuroFilter {
  private previousValue: number | null = null;
  private previousDerivative = 0;
  private previousTimeMs = 0;

  constructor(private readonly params: OneEuroParams = DEFAULT_ONE_EURO) {}

  filter(value: number, timestampMs: number): number {
    if (this.previousValue === null) {
      this.previousValue = value;
      this.previousTimeMs = timestampMs;
      return value;
    }
    const dtSeconds = (timestampMs - this.previousTimeMs) / MS_PER_SECOND;
    // carimbos repetidos ou fora de ordem não alteram o estado
    if (dtSeconds <= 0) return this.previousValue;

    const rawDerivative = (value - this.previousValue) / dtSeconds;
    const derivativeAlpha = smoothingFactor(dtSeconds, this.params.dCutoff);
    const derivative =
      this.previousDerivative + derivativeAlpha * (rawDerivative - this.previousDerivative);
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(derivative);
    const filtered =
      this.previousValue + smoothingFactor(dtSeconds, cutoff) * (value - this.previousValue);

    this.previousValue = filtered;
    this.previousDerivative = derivative;
    this.previousTimeMs = timestampMs;
    return filtered;
  }

  reset(): void {
    this.previousValue = null;
    this.previousDerivative = 0;
  }
}

// aplica um filtro independente a cada coordenada de cada ponto da mão
export class LandmarkSmoother {
  private filters: [OneEuroFilter, OneEuroFilter, OneEuroFilter][] = [];

  constructor(private readonly params: OneEuroParams = DEFAULT_ONE_EURO) {}

  smooth(hand: HandLandmarks, timestampMs: number): Landmark[] {
    return hand.map((landmark, index) => {
      const [fx, fy, fz] = this.filtersFor(index);
      return {
        x: fx.filter(landmark.x, timestampMs),
        y: fy.filter(landmark.y, timestampMs),
        z: fz.filter(landmark.z, timestampMs),
      };
    });
  }

  reset(): void {
    this.filters = [];
  }

  private filtersFor(index: number): [OneEuroFilter, OneEuroFilter, OneEuroFilter] {
    this.filters[index] ??= [
      new OneEuroFilter(this.params),
      new OneEuroFilter(this.params),
      new OneEuroFilter(this.params),
    ];
    return this.filters[index];
  }
}
