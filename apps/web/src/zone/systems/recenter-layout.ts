import type { PanelLayout } from '../../shared/types/zone';
import { PANEL_SNAP_STEP_DEG } from '../config/constants';
import { normalizeYawDeg } from './belt-controller';
import { calcPanelAngularFootprint, resolvePanelPlacement, snapAngle } from './spherical';

const MIN_RECENTER_EDGE_MARGIN_DEG = 10;

function computeStepSpacingDeg(radiusA: number, radiusB: number, minStepDeg: number): number {
  const halfA = calcPanelAngularFootprint(radiusA).halfWidthDeg;
  const halfB = calcPanelAngularFootprint(radiusB).halfWidthDeg;
  const required = halfA + halfB + MIN_RECENTER_EDGE_MARGIN_DEG;
  const snappedUp = Math.ceil(required / PANEL_SNAP_STEP_DEG) * PANEL_SNAP_STEP_DEG;
  return Math.max(minStepDeg, snappedUp);
}

// reposiciona os painéis em arco à frente do yaw atual da câmera, calculando o espaçamento conforme o tamanho angular de cada painel
export function recenterPanelLayouts(
  currentLayouts: readonly PanelLayout[],
  cameraYawDeg: number,
  minSpacingDeg = 40,
): PanelLayout[] {
  if (currentLayouts.length === 0) return [];

  const centerYawDeg = normalizeYawDeg(snapAngle(cameraYawDeg, PANEL_SNAP_STEP_DEG));
  const count = currentLayouts.length;
  const centerIndex = Math.floor((count - 1) / 2);

  // calcula os deslocamentos angulares a partir do painel central respeitando a largura angular de cada raio
  const yawOffsets = new Array<number>(count).fill(0);
  for (let i = centerIndex - 1; i >= 0; i--) {
    const curr = currentLayouts[i];
    const rightNeighbor = currentLayouts[i + 1];
    const step = computeStepSpacingDeg(
      curr?.radiusM ?? 1.5,
      rightNeighbor?.radiusM ?? 1.5,
      minSpacingDeg,
    );
    yawOffsets[i] = (yawOffsets[i + 1] ?? 0) - step;
  }
  for (let i = centerIndex + 1; i < count; i++) {
    const leftNeighbor = currentLayouts[i - 1];
    const curr = currentLayouts[i];
    const step = computeStepSpacingDeg(
      leftNeighbor?.radiusM ?? 1.5,
      curr?.radiusM ?? 1.5,
      minSpacingDeg,
    );
    yawOffsets[i] = (yawOffsets[i - 1] ?? 0) + step;
  }

  // posiciona primeiro o painel central e depois os laterais para que o central permaneça exatamente à frente
  const order: number[] = [centerIndex];
  for (let offset = 1; offset < count; offset++) {
    if (centerIndex - offset >= 0) order.push(centerIndex - offset);
    if (centerIndex + offset < count) order.push(centerIndex + offset);
  }

  const placedByIndex = new Map<number, PanelLayout>();
  const placedList: PanelLayout[] = [];

  for (const idx of order) {
    const panel = currentLayouts[idx];
    if (!panel) continue;
    const rawTargetYaw = normalizeYawDeg(centerYawDeg + (yawOffsets[idx] ?? 0));
    const resolved = resolvePanelPlacement(
      {
        yawDeg: rawTargetYaw,
        pitchDeg: 0,
        radiusM: panel.radiusM,
      },
      placedList,
      panel.panelId,
    );
    const layout: PanelLayout = {
      panelId: panel.panelId,
      yawDeg: normalizeYawDeg(resolved.yawDeg),
      pitchDeg: resolved.pitchDeg,
      radiusM: resolved.radiusM,
    };
    placedByIndex.set(idx, layout);
    placedList.push(layout);
  }

  return currentLayouts.map((panel, idx) => placedByIndex.get(idx) ?? panel);
}
