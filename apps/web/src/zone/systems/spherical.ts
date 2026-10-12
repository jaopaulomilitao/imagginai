import type { PanelLayout } from '../../shared/types/zone';
import {
  ALLOWED_RADII_M,
  DEFAULT_PANEL_RADIUS_M,
  HANDLE_MAX_SCALE,
  HANDLE_MIN_SCALE,
  PANEL_DEFAULT_HEIGHT_M,
  PANEL_DEFAULT_WIDTH_M,
  PANEL_MIN_EDGE_GAP_DEG,
  PANEL_SNAP_STEP_DEG,
  PITCH_MAX_DEG,
  PITCH_MIN_DEG,
  RIG_ORIGIN,
  YAW_MAX_DEG,
  YAW_MIN_DEG,
  type PanelRadiusM,
} from '../config/constants';

export interface SphericalCoords {
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly radiusM: PanelRadiusM;
}

export interface CartesianPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PanelAngularFootprint {
  readonly halfWidthDeg: number;
  readonly halfHeightDeg: number;
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function snapAngle(angleDeg: number, stepDeg: number = PANEL_SNAP_STEP_DEG): number {
  const snapped = Math.round(angleDeg / stepDeg) * stepDeg;
  return Object.is(snapped, -0) ? 0 : snapped;
}

export function clampRadius(radiusM: number): PanelRadiusM {
  let best: PanelRadiusM = DEFAULT_PANEL_RADIUS_M;
  let minDiff = Number.POSITIVE_INFINITY;
  for (const candidate of ALLOWED_RADII_M) {
    const diff = Math.abs(radiusM - candidate);
    if (diff < minDiff) {
      minDiff = diff;
      best = candidate;
    }
  }
  return best;
}

export function cycleRadius(currentRadiusM: PanelRadiusM, direction: -1 | 1): PanelRadiusM {
  const index = ALLOWED_RADII_M.indexOf(currentRadiusM);
  const currentIndex = index === -1 ? 1 : index;
  const nextIndex = clampRange(currentIndex + direction, 0, ALLOWED_RADII_M.length - 1);
  return ALLOWED_RADII_M[nextIndex] ?? DEFAULT_PANEL_RADIUS_M;
}

// limita yaw em [-90, 90], pitch em [-25, 35] e raio em {1.0, 1.5, 2.0} (seção 3.1)
export function clampSpherical(coords: {
  yawDeg: number;
  pitchDeg: number;
  radiusM: number;
}): SphericalCoords {
  return {
    yawDeg: clampRange(coords.yawDeg, YAW_MIN_DEG, YAW_MAX_DEG),
    pitchDeg: clampRange(coords.pitchDeg, PITCH_MIN_DEG, PITCH_MAX_DEG),
    radiusM: clampRadius(coords.radiusM),
  };
}

// arredonda yaw e pitch para múltiplos de 10° e aplica os limites da seção 3.1
export function snapAndClampSpherical(
  coords: { yawDeg: number; pitchDeg: number; radiusM: number },
  stepDeg: number = PANEL_SNAP_STEP_DEG,
): SphericalCoords {
  const clamped = clampSpherical(coords);
  const yawSnapped = clampRange(snapAngle(clamped.yawDeg, stepDeg), YAW_MIN_DEG, YAW_MAX_DEG);
  const pitchSnapped = clampRange(
    snapAngle(clamped.pitchDeg, stepDeg),
    PITCH_MIN_DEG,
    PITCH_MAX_DEG,
  );
  return {
    yawDeg: yawSnapped,
    pitchDeg: pitchSnapped,
    radiusM: clamped.radiusM,
  };
}

// converte coordenadas esféricas relativas ao usuário sentado na origem do rig (0, 1.2, 0) para cartesianas;
// yaw positivo gira para a direita (+x), pitch positivo gira para cima (+y), frente em -z
export function sphericalToCartesian(
  coords: SphericalCoords,
  origin: CartesianPoint = RIG_ORIGIN,
): CartesianPoint {
  const yawRad = degToRad(coords.yawDeg);
  const pitchRad = degToRad(coords.pitchDeg);
  const horizontal = coords.radiusM * Math.cos(pitchRad);
  return {
    x: origin.x + horizontal * Math.sin(yawRad),
    y: origin.y + coords.radiusM * Math.sin(pitchRad),
    z: origin.z - horizontal * Math.cos(yawRad),
  };
}

// converte um vetor de direção do mundo (ex.: raio do olhar) em ângulos esféricos (yaw e pitch em graus)
export function directionToSphericalAngles(direction: CartesianPoint): {
  yawDeg: number;
  pitchDeg: number;
} {
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length === 0) return { yawDeg: 0, pitchDeg: 0 };
  const nx = direction.x / length;
  const ny = direction.y / length;
  const nz = direction.z / length;
  const yawDeg = radToDeg(Math.atan2(nx, -nz));
  const pitchDeg = radToDeg(Math.asin(clampRange(ny, -1, 1)));
  return { yawDeg, pitchDeg };
}

// os painéis giram em torno de y para encarar o usuário na origem (seção 3.1)
export function panelFacingYawDeg(yawDeg: number): number {
  const rotationY = -yawDeg;
  return Object.is(rotationY, -0) ? 0 : rotationY;
}

// inclina o painel em torno de x (pitch) para que fique tangente à esfera voltada ao usuário
export function panelFacingPitchDeg(pitchDeg: number): number {
  const rotationX = pitchDeg;
  return Object.is(rotationX, -0) ? 0 : rotationX;
}

// calcula a escala da barra de controle proporcional à distância, limitada entre HANDLE_MIN_SCALE e HANDLE_MAX_SCALE
export function calcHandleBarScale(radiusM: number): number {
  return clampRange(radiusM / DEFAULT_PANEL_RADIUS_M, HANDLE_MIN_SCALE, HANDLE_MAX_SCALE);
}

// calcula a meia-largura e meia-altura angulares (em graus) de um painel a uma dada distância
export function calcPanelAngularFootprint(
  radiusM: number,
  widthM: number = PANEL_DEFAULT_WIDTH_M,
  heightM: number = PANEL_DEFAULT_HEIGHT_M,
): PanelAngularFootprint {
  return {
    halfWidthDeg: radToDeg(Math.atan2(widthM / 2, radiusM)),
    halfHeightDeg: radToDeg(Math.atan2(heightM / 2, radiusM)),
  };
}

// calcula a menor distância angular circular em graus no intervalo [0, 180]
export function angularDistanceDeg(aDeg: number, bDeg: number): number {
  const diff = Math.abs(aDeg - bDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// verifica se dois painéis colidem angularmente (distância entre bordas < 5°, seção 3.6.4)
export function hasAngularCollision(
  a: { yawDeg: number; pitchDeg: number; radiusM: PanelRadiusM },
  b: { yawDeg: number; pitchDeg: number; radiusM: PanelRadiusM },
  minGapDeg: number = PANEL_MIN_EDGE_GAP_DEG,
  widthM: number = PANEL_DEFAULT_WIDTH_M,
  heightM: number = PANEL_DEFAULT_HEIGHT_M,
): boolean {
  const footprintA = calcPanelAngularFootprint(Math.max(a.radiusM, 1.0), widthM, heightM);
  const footprintB = calcPanelAngularFootprint(Math.max(b.radiusM, 1.0), widthM, heightM);
  const yawEdgeGap =
    angularDistanceDeg(a.yawDeg, b.yawDeg) - (footprintA.halfWidthDeg + footprintB.halfWidthDeg);
  const pitchEdgeGap =
    Math.abs(a.pitchDeg - b.pitchDeg) - (footprintA.halfHeightDeg + footprintB.halfHeightDeg);
  return yawEdgeGap < minGapDeg && pitchEdgeGap < minGapDeg;
}

function buildSnapCandidateSlots(stepDeg: number): { yawDeg: number; pitchDeg: number }[] {
  const slots: { yawDeg: number; pitchDeg: number }[] = [];
  const minPitchSlot = Math.ceil(PITCH_MIN_DEG / stepDeg) * stepDeg;
  const maxPitchSlot = Math.floor(PITCH_MAX_DEG / stepDeg) * stepDeg;
  const minYawSlot = Math.ceil(YAW_MIN_DEG / stepDeg) * stepDeg;
  const maxYawSlot = Math.floor(YAW_MAX_DEG / stepDeg) * stepDeg;

  for (let pitch = minPitchSlot; pitch <= maxPitchSlot; pitch += stepDeg) {
    for (let yaw = minYawSlot; yaw <= maxYawSlot; yaw += stepDeg) {
      slots.push({
        yawDeg: Object.is(yaw, -0) ? 0 : yaw,
        pitchDeg: Object.is(pitch, -0) ? 0 : pitch,
      });
    }
  }
  return slots;
}

// aplica snap de 10°, limita à faixa permitida e move para o slot livre mais próximo se houver colisão (< 5°)
export function resolvePanelPlacement(
  desired: { yawDeg: number; pitchDeg: number; radiusM: number },
  others: readonly PanelLayout[],
  movingPanelId?: string,
  widthM: number = PANEL_DEFAULT_WIDTH_M,
  heightM: number = PANEL_DEFAULT_HEIGHT_M,
): SphericalCoords {
  const snapped = snapAndClampSpherical(desired);
  const obstacles = others.filter((item) => item.panelId !== movingPanelId);

  const collidesWithAny = (candidate: SphericalCoords): boolean =>
    obstacles.some((other) =>
      hasAngularCollision(candidate, other, PANEL_MIN_EDGE_GAP_DEG, widthM, heightM),
    );

  if (!collidesWithAny(snapped)) {
    return snapped;
  }

  const candidates = buildSnapCandidateSlots(PANEL_SNAP_STEP_DEG);
  candidates.sort((slotA, slotB) => {
    const distA = Math.hypot(
      angularDistanceDeg(slotA.yawDeg, snapped.yawDeg),
      slotA.pitchDeg - snapped.pitchDeg,
    );
    const distB = Math.hypot(
      angularDistanceDeg(slotB.yawDeg, snapped.yawDeg),
      slotB.pitchDeg - snapped.pitchDeg,
    );
    if (Math.abs(distA - distB) > 1e-6) return distA - distB;
    // desempate determinístico: prefere menor deslocamento vertical, depois yaw mais próximo do centro
    const pitchDiff =
      Math.abs(slotA.pitchDeg - snapped.pitchDeg) - Math.abs(slotB.pitchDeg - snapped.pitchDeg);
    if (pitchDiff !== 0) return pitchDiff;
    return Math.abs(slotA.yawDeg) - Math.abs(slotB.yawDeg);
  });

  for (const slot of candidates) {
    const candidate: SphericalCoords = {
      yawDeg: slot.yawDeg,
      pitchDeg: slot.pitchDeg,
      radiusM: snapped.radiusM,
    };
    if (!collidesWithAny(candidate)) {
      return candidate;
    }
  }

  return snapped;
}
