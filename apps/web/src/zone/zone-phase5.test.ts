import { describe, expect, it } from 'vitest';

import {
  BELT_ARC_MAX_HALF_WIDTH_DEG,
  BELT_CENTER_PITCH_DEG,
  BELT_MAX_ITEMS,
  POMODORO_BREAK_5_MS,
  POMODORO_FOCUS_20_MS,
  POMODORO_FOCUS_25_MS,
} from './config/constants';
import {
  BeltMenuController,
  computeBeltItemPlacements,
  lerpYawDeg,
  normalizeYawDeg,
} from './systems/belt-controller';
import {
  buildWelcomePlaceholderSpec,
  computeCollisionFreeSpawnPlacement,
  DEFAULT_INITIAL_PANEL_LAYOUTS,
  WELCOME_PLACEHOLDER_PANEL_ID,
} from './systems/initial-panels';
import { formatPomodoroMmSs, PomodoroSystem } from './systems/pomodoro-system';
import { recenterPanelLayouts } from './systems/recenter-layout';
import { hasAngularCollision } from './systems/spherical';

describe('Phase 5 — Belt Menu hysteresis, gaze retention, intersection lock & exit confirmation', () => {
  it('does not open while reading panel bottoms above threshold', () => {
    const belt = new BeltMenuController();
    belt.update(0, -25, 1000);
    expect(belt.snapshot.visible).toBe(false);
    expect(belt.snapshot.lowPitchAccumulatedMs).toBe(0);

    belt.update(0, -28, 1000);
    expect(belt.snapshot.visible).toBe(false);
  });

  it('opens after pitch < -28° for >= 350 ms, fades in opacity, and retains visibility until looking away', () => {
    const belt = new BeltMenuController();

    belt.update(15, -35, 200);
    expect(belt.snapshot.visible).toBe(false);

    belt.update(15, -35, 200);
    expect(belt.snapshot.visible).toBe(true);
    expect(belt.snapshot.opacity).toBeGreaterThan(0);

    // permanece aberto na faixa ergonômica (-26° e -16°)
    belt.update(25, -26, 200);
    expect(belt.snapshot.visible).toBe(true);
    expect(belt.snapshot.opacity).toBe(1);
    belt.update(25, -16, 200);
    expect(belt.snapshot.visible).toBe(true);

    // fecha somente quando o olhar sobe acima do limite sem submenu aberto
    belt.update(25, -10, 50);
    expect(belt.snapshot.visible).toBe(false);
  });

  it('retains menu visibility when submenu is open or pointer intersects menu, closing only when looking completely away', () => {
    const belt = new BeltMenuController();
    belt.update(0, -35, 400);
    expect(belt.snapshot.visible).toBe(true);

    // abre o submenu conteúdos: olhar para cima em direção ao submenu (pitch +10°) não fecha o menu
    belt.setSubmenuOpen(true);
    belt.update(0, 10, 200);
    expect(belt.snapshot.visible).toBe(true);

    // trava de interseção: enquanto o ponteiro está sobre o menu/submenu, jamais fecha mesmo em ângulos extremos
    belt.setPointerIntersecting(true);
    belt.update(90, 45, 200);
    expect(belt.snapshot.visible).toBe(true);

    // quando sai da interseção e olha completamente para fora do menu e do submenu, fecha
    belt.setPointerIntersecting(false);
    belt.update(90, 35, 200);
    expect(belt.snapshot.visible).toBe(false);
  });

  it('smoothly follows head yaw while hidden and freezes yaw while visible', () => {
    const belt = new BeltMenuController();
    belt.update(0, 0, 16);
    expect(belt.snapshot.beltYawDeg).toBe(0);

    belt.update(100, 0, 16);
    expect(belt.snapshot.beltYawDeg).toBeCloseTo(10, 5);

    // abre o menu olhando para yaw = 60° e pitch = -36°
    belt.update(60, -36, 400);
    expect(belt.snapshot.visible).toBe(true);
    expect(belt.snapshot.beltYawDeg).toBe(60);

    // enquanto visível dentro da janela angular, mover a cabeça horizontalmente não altera o yaw do cinto
    belt.update(20, -30, 200);
    expect(belt.snapshot.visible).toBe(true);
    expect(belt.snapshot.beltYawDeg).toBe(60);
  });

  it('interpolates yaw across the -180° / +180° seam along the shortest arc', () => {
    expect(normalizeYawDeg(190)).toBe(-170);
    expect(normalizeYawDeg(-190)).toBe(170);
    const interpolated = lerpYawDeg(175, -175, 0.5);
    expect(Math.abs(interpolated)).toBe(180);
  });

  it('requires a second confirmation within 3 seconds for exit-zone', () => {
    const belt = new BeltMenuController();
    belt.update(0, -35, 400);

    expect(belt.triggerExitAction()).toBe('confirm-pending');
    expect(belt.snapshot.exitConfirmPending).toBe(true);

    belt.update(0, -35, 2000);
    expect(belt.snapshot.exitConfirmPending).toBe(true);
    expect(belt.triggerExitAction()).toBe('confirmed');
    expect(belt.snapshot.exitConfirmPending).toBe(false);

    expect(belt.triggerExitAction()).toBe('confirm-pending');
    belt.update(0, -35, 3100);
    expect(belt.snapshot.exitConfirmPending).toBe(false);
    expect(belt.triggerExitAction()).toBe('confirm-pending');
  });

  it('places 7 belt items with wide gap and highlights open-contents right in the center (yawOffsetDeg = 0)', () => {
    const placements = computeBeltItemPlacements();
    expect(placements.length).toBeLessThanOrEqual(BELT_MAX_ITEMS);
    expect(placements).toHaveLength(7);

    const centerItem = placements[3];
    expect(centerItem?.id).toBe('open-contents');
    expect(centerItem?.yawOffsetDeg).toBe(0);
    expect(centerItem?.prominent).toBe(true);

    for (const item of placements) {
      expect(item.pitchDeg).toBe(BELT_CENTER_PITCH_DEG);
      expect(Math.abs(item.yawOffsetDeg)).toBeLessThanOrEqual(BELT_ARC_MAX_HALF_WIDTH_DEG);
      expect(item.prominent).toBe(item.id === 'open-contents');
    }
  });

  it('builds a single smaller low-opacity centered welcome placeholder and spawns new items without collision', () => {
    const welcome = buildWelcomePlaceholderSpec();
    expect(welcome.panelId).toBe(WELCOME_PLACEHOLDER_PANEL_ID);
    expect(welcome.defaultLayout.yawDeg).toBe(0);
    expect(welcome.defaultLayout.pitchDeg).toBe(0);
    expect(welcome.opacityScale).toBeLessThan(0.8);

    const firstSpawn = computeCollisionFreeSpawnPlacement([], 0, 'spawn-1');
    const secondSpawn = computeCollisionFreeSpawnPlacement([firstSpawn], 0, 'spawn-2');
    const thirdSpawn = computeCollisionFreeSpawnPlacement([firstSpawn, secondSpawn], 0, 'spawn-3');

    expect(hasAngularCollision(firstSpawn, secondSpawn)).toBe(false);
    expect(hasAngularCollision(firstSpawn, thirdSpawn)).toBe(false);
    expect(hasAngularCollision(secondSpawn, thirdSpawn)).toBe(false);
  });
});

describe('Phase 5 — PomodoroSystem timer with fake clock', () => {
  it('supports 25/5 and 20/5 presets, pause/resume, 1-min warning, and break transition', () => {
    const pomodoro = new PomodoroSystem('25/5');
    expect(pomodoro.snapshot.phase).toBe('idle');
    expect(pomodoro.snapshot.remainingMs).toBe(POMODORO_FOCUS_25_MS);
    expect(formatPomodoroMmSs(pomodoro.snapshot.remainingMs)).toBe('25:00');

    pomodoro.toggle();
    expect(pomodoro.snapshot.phase).toBe('focus');

    const beforeWarn = pomodoro.step(23 * 60 * 1000 + 59 * 1000);
    expect(beforeWarn.warningJustTriggered).toBe(false);
    expect(pomodoro.snapshot.oneMinuteWarningActive).toBe(false);

    const atWarn = pomodoro.step(1000);
    expect(atWarn.warningJustTriggered).toBe(true);
    expect(pomodoro.snapshot.oneMinuteWarningActive).toBe(true);
    expect(formatPomodoroMmSs(pomodoro.snapshot.remainingMs)).toBe('01:00');

    pomodoro.toggle();
    expect(pomodoro.snapshot.phase).toBe('paused');
    pomodoro.step(30_000);
    expect(pomodoro.snapshot.remainingMs).toBe(60_000);

    pomodoro.toggle();
    expect(pomodoro.snapshot.phase).toBe('focus');
    const endFocus = pomodoro.step(60_000);
    expect(endFocus.breakJustStarted).toBe(true);
    expect(pomodoro.snapshot.phase).toBe('break');
    expect(pomodoro.snapshot.completedBlocks).toBe(1);
    expect(pomodoro.snapshot.remainingMs).toBe(POMODORO_BREAK_5_MS);

    const endBreak = pomodoro.step(POMODORO_BREAK_5_MS);
    expect(endBreak.breakJustEnded).toBe(true);
    expect(pomodoro.snapshot.phase).toBe('idle');

    pomodoro.setPreset('20/5');
    expect(pomodoro.snapshot.remainingMs).toBe(POMODORO_FOCUS_20_MS);
    expect(formatPomodoroMmSs(pomodoro.snapshot.remainingMs)).toBe('20:00');
  });
});

describe('Phase 5 — Recenter panel layouts', () => {
  it('re-aligns the 3 workspace panels around the user camera yaw at pitch 0° with radius-aware spacing', () => {
    const custom = DEFAULT_INITIAL_PANEL_LAYOUTS.map((p, idx) => ({
      ...p,
      pitchDeg: 20,
      radiusM: idx === 1 ? (0.75 as const) : p.radiusM,
    }));

    const recentered = recenterPanelLayouts(custom, 92);
    expect(recentered).toHaveLength(3);
    expect(recentered[0]?.yawDeg).toBe(40);
    expect(recentered[1]?.yawDeg).toBe(90);
    expect(recentered[2]?.yawDeg).toBe(140);
    expect(recentered.every((p) => p.pitchDeg === 0)).toBe(true);
    expect(recentered[1]?.radiusM).toBe(0.75);

    const closePanels = DEFAULT_INITIAL_PANEL_LAYOUTS.map((p) => ({
      ...p,
      radiusM: 0.55 as const,
    }));
    const recenteredClose = recenterPanelLayouts(closePanels, 0);
    expect(recenteredClose[0]?.yawDeg).toBe(-80);
    expect(recenteredClose[1]?.yawDeg).toBe(0);
    expect(recenteredClose[2]?.yawDeg).toBe(80);
  });
});
