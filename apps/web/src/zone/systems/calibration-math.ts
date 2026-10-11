import { DEFAULT_CAMERA_VFOV_DEG, PASSTHROUGH_PLANE_DISTANCE_M } from '../config/constants';

export interface PlaneDimensions {
  readonly distanceM: number;
  readonly widthM: number;
  readonly heightM: number;
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// calcula o tamanho do plano preso à cabeça a partir do fov vertical da câmera (seção 3.7)
export function calcPassthroughPlaneSize(
  videoWidth: number,
  videoHeight: number,
  camVFovDeg: number = DEFAULT_CAMERA_VFOV_DEG,
  distanceM: number = PASSTHROUGH_PLANE_DISTANCE_M,
): PlaneDimensions {
  if (!(videoWidth > 0 && videoHeight > 0)) {
    throw new RangeError('video dimensions must be positive');
  }
  if (!(distanceM > 0)) {
    throw new RangeError('distanceM must be positive');
  }
  const shortSideM = 2 * distanceM * Math.tan(degreesToRadians(camVFovDeg) / 2);
  if (videoWidth >= videoHeight) {
    return {
      distanceM,
      widthM: shortSideM * (videoWidth / videoHeight),
      heightM: shortSideM,
    };
  }
  return {
    distanceM,
    widthM: shortSideM,
    heightM: shortSideM * (videoHeight / videoWidth),
  };
}
