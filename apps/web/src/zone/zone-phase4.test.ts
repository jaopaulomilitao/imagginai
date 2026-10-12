import { describe, expect, it } from 'vitest';

import demoPackRaw from '../../../../fixtures/demo-pack.json';
import { mergePanelIntoLayout } from '../shared/storage/dexie-db';
import type { PanelLayout } from '../shared/types/zone';
import { validateStudyPack } from '../shared/validation/study-pack-validator';
import {
  DWELL_DURATION_MS,
  HANDLE_HOVER_REVEAL_MS,
  PITCH_MAX_DEG,
  PITCH_MIN_DEG,
  RIG_ORIGIN,
  YAW_MAX_DEG,
  YAW_MIN_DEG,
} from './config/constants';
import { DragHandleStateMachine, DwellTimer } from './systems/dwell-controller';
import {
  buildDemoPdfPageContent,
  buildInitialZonePanels,
  resolveInitialPanelLayouts,
} from './systems/initial-panels';
import { computePdfPageWindow } from './systems/pdf-page-window';
import {
  calcHandleBarScale,
  calcPanelAngularFootprint,
  clampSpherical,
  cycleRadius,
  directionToSphericalAngles,
  hasAngularCollision,
  panelFacingPitchDeg,
  panelFacingYawDeg,
  resolvePanelPlacement,
  snapAndClampSpherical,
  sphericalToCartesian,
} from './systems/spherical';

describe('spherical coordinates, 10 deg snap, and range clamping (section 3.1 & 3.6.4)', () => {
  it('converts spherical coordinates relative to rig origin (0, 1.2, 0) into cartesian coordinates', () => {
    const front = sphericalToCartesian({ yawDeg: 0, pitchDeg: 0, radiusM: 1.5 });
    expect(front.x).toBeCloseTo(0, 6);
    expect(front.y).toBeCloseTo(RIG_ORIGIN.y, 6);
    expect(front.z).toBeCloseTo(-1.5, 6);

    const right = sphericalToCartesian({ yawDeg: 90, pitchDeg: 0, radiusM: 2.0 });
    expect(right.x).toBeCloseTo(2.0, 6);
    expect(right.y).toBeCloseTo(RIG_ORIGIN.y, 6);
    expect(right.z).toBeCloseTo(0, 6);

    const left = sphericalToCartesian({ yawDeg: -90, pitchDeg: 0, radiusM: 1.0 });
    expect(left.x).toBeCloseTo(-1.0, 6);
    expect(left.y).toBeCloseTo(RIG_ORIGIN.y, 6);
    expect(left.z).toBeCloseTo(0, 6);
  });

  it('inverts direction vectors back into yaw/pitch angles and rotates panels to face the user in yaw and pitch', () => {
    const point = sphericalToCartesian(
      { yawDeg: -30, pitchDeg: 20, radiusM: 1.5 },
      { x: 0, y: 0, z: 0 },
    );
    const angles = directionToSphericalAngles(point);
    expect(angles.yawDeg).toBeCloseTo(-30, 5);
    expect(angles.pitchDeg).toBeCloseTo(20, 5);
    expect(panelFacingYawDeg(-30)).toBe(30);
    expect(panelFacingYawDeg(0)).toBe(0);
    expect(panelFacingPitchDeg(25)).toBe(25);
    expect(panelFacingPitchDeg(-15)).toBe(-15);
    expect(panelFacingPitchDeg(0)).toBe(0);
  });

  it('clamps yaw to [-180, 180], pitch to [-80, 80], and radius to {0.55, 0.75, 1.0, 1.5, 2.0}', () => {
    const clamped = clampSpherical({ yawDeg: -220, pitchDeg: -95, radiusM: 0.3 });
    expect(clamped).toEqual({
      yawDeg: YAW_MIN_DEG,
      pitchDeg: PITCH_MIN_DEG,
      radiusM: 0.55,
    });

    const clampedHigh = clampSpherical({ yawDeg: 220, pitchDeg: 95, radiusM: 1.9 });
    expect(clampedHigh).toEqual({
      yawDeg: YAW_MAX_DEG,
      pitchDeg: PITCH_MAX_DEG,
      radiusM: 2.0,
    });

    const behindUser = clampSpherical({ yawDeg: 160, pitchDeg: 50, radiusM: 1.5 });
    expect(behindUser).toEqual({
      yawDeg: 160,
      pitchDeg: 50,
      radiusM: 1.5,
    });
  });

  it('snaps yaw and pitch to multiples of 10 degrees while respecting pitch >= -25', () => {
    expect(snapAndClampSpherical({ yawDeg: -26, pitchDeg: 14, radiusM: 1.5 })).toEqual({
      yawDeg: -30,
      pitchDeg: 10,
      radiusM: 1.5,
    });

    // -24 arredondaria para -20; -25 limitado a múltiplos de 10 e faixa [-25, 35]
    const bottomEdge = snapAndClampSpherical({ yawDeg: 4, pitchDeg: -25, radiusM: 1.5 });
    expect(bottomEdge.pitchDeg).toBeGreaterThanOrEqual(PITCH_MIN_DEG);
    expect(bottomEdge.yawDeg).toBe(0);
  });

  it('cycles radiusM across 0.55..2.0 and clamps handle bar scale between min and max bounds', () => {
    expect(cycleRadius(1.5, -1)).toBe(1.0);
    expect(cycleRadius(1.0, -1)).toBe(0.75);
    expect(cycleRadius(0.75, -1)).toBe(0.55);
    expect(cycleRadius(0.55, -1)).toBe(0.55);
    expect(cycleRadius(1.5, 1)).toBe(2.0);
    expect(cycleRadius(2.0, 1)).toBe(2.0);

    expect(calcHandleBarScale(1.5)).toBeCloseTo(1.0, 5);
    expect(calcHandleBarScale(0.55)).toBeCloseTo(0.55, 5);
    expect(calcHandleBarScale(2.0)).toBeCloseTo(1.15, 5);
  });
});

describe('panel angular collision avoidance (< 5 deg edge gap, section 3.6.4)', () => {
  it('detects angular collision when edge gap is smaller than 5 degrees', () => {
    const footprint = calcPanelAngularFootprint(1.5);
    expect(footprint.halfWidthDeg).toBeGreaterThan(10);

    const panelA = { yawDeg: 0, pitchDeg: 0, radiusM: 1.5 as const };
    const overlapping = { yawDeg: 10, pitchDeg: 0, radiusM: 1.5 as const };
    const wellSeparated = { yawDeg: 40, pitchDeg: 0, radiusM: 1.5 as const };

    expect(hasAngularCollision(panelA, overlapping)).toBe(true);
    expect(hasAngularCollision(panelA, wellSeparated)).toBe(false);
  });

  it('moves dropped panel to the nearest free 10-degree slot when colliding with an existing panel', () => {
    const centerPanel: PanelLayout = { panelId: 'panel-1', yawDeg: 0, pitchDeg: 0, radiusM: 1.5 };
    const existing: PanelLayout[] = [centerPanel];

    const resolved = resolvePanelPlacement(
      { yawDeg: 2, pitchDeg: 1, radiusM: 1.5 },
      existing,
      'panel-2',
    );

    expect(Math.abs(resolved.yawDeg % 10)).toBe(0);
    expect(Math.abs(resolved.pitchDeg % 10)).toBe(0);
    expect(hasAngularCollision(resolved, centerPanel)).toBe(false);
  });
});

describe('DwellTimer (800 ms) and DragHandleStateMachine (300 ms reveal)', () => {
  it('progresses from 0 to 1 over 800 ms and fires once per target hover', () => {
    const timer = new DwellTimer<string>(DWELL_DURATION_MS);
    timer.setTarget('btn-1');

    const half = timer.step(400);
    expect(half.triggered).toBe(false);
    expect(half.progress).toBeCloseTo(0.5, 5);

    const full = timer.step(400);
    expect(full.triggered).toBe(true);
    expect(full.progress).toBe(1);

    // não dispara uma segunda vez sem sair ou reiniciar o alvo
    const after = timer.step(400);
    expect(after.triggered).toBe(false);
    expect(after.progress).toBe(0);
  });

  it('reveals 6-dot handle after 300 ms hover and supports grab-drag, pinch-drag, and dwell-drag', () => {
    const handle = new DragHandleStateMachine(HANDLE_HOVER_REVEAL_MS);
    expect(handle.isHandleVisible).toBe(false);

    handle.setPanelHovered(true);
    handle.stepHover(200);
    expect(handle.isHandleVisible).toBe(false);

    handle.stepHover(100);
    expect(handle.isHandleVisible).toBe(true);

    // arraste por dwell: primeiro dwell inicia, segundo dwell solta
    expect(handle.toggleDwellDrag()).toBe('started');
    expect(handle.isDragging).toBe(true);
    expect(handle.toggleDwellDrag()).toBe('dropped');
    expect(handle.isDragging).toBe(false);

    // arraste por mão fechada (grab)
    expect(handle.startGrabDrag()).toBe(true);
    expect(handle.isDragging).toBe(true);
    expect(handle.mode).toBe('grab');
    expect(handle.endGrabDrag()).toBe(true);
    expect(handle.isDragging).toBe(false);

    // arraste por pinça (compatibilidade)
    expect(handle.startPinchDrag()).toBe(true);
    expect(handle.isDragging).toBe(true);
    expect(handle.endPinchDrag()).toBe(true);
    expect(handle.isDragging).toBe(false);
  });
});

describe('PDF sliding page window (current page +- 1) and initial demo pack panels', () => {
  it('keeps only current page +- 1 in cache and evicts pages outside the window', () => {
    const page1 = computePdfPageWindow(1, 5, []);
    expect(page1.pagesToKeep).toEqual([1, 2]);
    expect(page1.pagesToRender).toEqual([1, 2]);
    expect(page1.pagesToEvict).toEqual([]);

    const movePage3 = computePdfPageWindow(3, 5, [1, 2]);
    expect(movePage3.pagesToKeep).toEqual([2, 3, 4]);
    expect(movePage3.pagesToRender).toEqual([3, 4]);
    expect(movePage3.pagesToEvict).toEqual([1]);
  });

  it('builds 3 non-colliding initial panels from fixtures/demo-pack.json and merges saved layouts', () => {
    const result = validateStudyPack(demoPackRaw);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const pack = result.pack;
    const panels = buildInitialZonePanels(pack);
    expect(panels).toHaveLength(3);

    const [p1, p2, p3] = panels.map((p) => p.defaultLayout);
    if (!p1 || !p2 || !p3) throw new Error('expected 3 initial panel layouts');
    expect(hasAngularCollision(p1, p2)).toBe(false);
    expect(hasAngularCollision(p2, p3)).toBe(false);
    expect(hasAngularCollision(p1, p3)).toBe(false);

    const updatedLayout = mergePanelIntoLayout(
      panels.map((p) => p.defaultLayout),
      { panelId: 'panel-pdf-1', yawDeg: 0, pitchDeg: 20, radiusM: 2.0 },
    );
    const restored = resolveInitialPanelLayouts(updatedLayout);
    expect(restored.find((item) => item.panelId === 'panel-pdf-1')).toEqual({
      panelId: 'panel-pdf-1',
      yawDeg: 0,
      pitchDeg: 20,
      radiusM: 2.0,
    });

    const page1Content = buildDemoPdfPageContent(pack, 1);
    expect(page1Content.pageNumber).toBe(1);
    expect(page1Content.pageCount).toBe(4);
    expect(page1Content.paragraphs.length).toBeGreaterThan(0);
  });
});
