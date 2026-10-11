import type { Landmark } from '../core/landmarks';

export interface CalibrationSettings {
  // campo de visão vertical real da câmera traseira, em graus
  camVFovDeg: number;
  // distância do plano de projeção comum ao vídeo e às mãos, em metros
  planeDistanceM: number;
  // coeficiente de distorção radial leve aplicado ao vídeo
  k1: number;
}

export const DEFAULT_CALIBRATION: Readonly<CalibrationSettings> = {
  camVFovDeg: 50,
  planeDistanceM: 1.0,
  k1: 0,
};

const MIN_FOV_DEG = 10;
const MAX_FOV_DEG = 120;

export interface ProjectionPlane {
  readonly distanceM: number;
  readonly widthM: number;
  readonly heightM: number;
}

export interface PlanePoint {
  x: number;
  y: number;
  z: number;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function assertSettings(settings: CalibrationSettings): void {
  if (!(settings.camVFovDeg > MIN_FOV_DEG && settings.camVFovDeg < MAX_FOV_DEG)) {
    throw new RangeError(`camVFovDeg must be in (${MIN_FOV_DEG}, ${MAX_FOV_DEG})`);
  }
  if (!(settings.planeDistanceM > 0)) throw new RangeError('planeDistanceM must be > 0');
  if (!Number.isFinite(settings.k1)) throw new RangeError('k1 must be finite');
}

// fonte única da geometria: o mesmo plano dimensiona o vídeo e posiciona os pontos da mão
export class CalibrationProfile {
  readonly camVFovDeg: number;
  readonly planeDistanceM: number;
  readonly k1: number;

  constructor(overrides: Partial<CalibrationSettings> = {}) {
    const settings = { ...DEFAULT_CALIBRATION, ...overrides };
    assertSettings(settings);
    this.camVFovDeg = settings.camVFovDeg;
    this.planeDistanceM = settings.planeDistanceM;
    this.k1 = settings.k1;
  }

  // em paisagem (uso no óculos): h = 2·d·tan(fov/2) e w = h·(largura/altura), conforme a seção 3.7;
  // o fov calibrado pertence ao lado curto do sensor, por isso em retrato ele passa a valer para a largura
  projectionPlane(
    videoWidth: number,
    videoHeight: number,
    distanceM = this.planeDistanceM,
  ): ProjectionPlane {
    if (!(videoWidth > 0 && videoHeight > 0)) throw new RangeError('video size must be > 0');
    const shortSideM = 2 * distanceM * Math.tan(degreesToRadians(this.camVFovDeg) / 2);
    if (videoWidth >= videoHeight) {
      return { distanceM, widthM: shortSideM * (videoWidth / videoHeight), heightM: shortSideM };
    }
    return { distanceM, widthM: shortSideM, heightM: shortSideM * (videoHeight / videoWidth) };
  }

  // a profundidade relativa do mediapipe usa a mesma escala de x, por isso é multiplicada pela largura
  mapLandmark(landmark: Landmark, plane: ProjectionPlane): PlanePoint {
    return {
      x: (landmark.x - 0.5) * plane.widthM,
      y: -(landmark.y - 0.5) * plane.heightM,
      z: -plane.distanceM + landmark.z * plane.widthM,
    };
  }

  toJSON(): CalibrationSettings {
    return { camVFovDeg: this.camVFovDeg, planeDistanceM: this.planeDistanceM, k1: this.k1 };
  }
}
