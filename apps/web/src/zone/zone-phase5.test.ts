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
import { DEFAULT_INITIAL_PANEL_LAYOUTS } from './systems/initial-panels';
import { formatPomodoroMmSs, PomodoroSystem } from './systems/pomodoro-system';
import { recenterPanelLayouts } from './systems/recenter-layout';

describe('Phase 5 — Belt Menu hysteresis, yaw freeze & exit confirmation', () => {
  it('does not open while reading panel bottoms at pitch -25° or exactly -30°', () => {
    const belt = new BeltMenuController();
    belt.update(0, -25, 1000);
    expect(belt.snapshot.visible).toBe(false);
    expect(belt.snapshot.lowPitchAccumulatedMs).toBe(0);

    belt.update(0, -30, 1000);
    expect(belt.snapshot.visible).toBe(false);
  });

  it('opens after pitch < -30° for >= 400 ms and hides only when pitch > -20°', () => {
    const belt = new BeltMenuController();

    belt.update(15, -35, 250);
    expect(belt.snapshot.visible).toBe(false);

    belt.update(15, -35, 150);
    expect(belt.snapshot.visible).toBe(true);

    // permanece aberto na faixa de histerese (-28° e -20°)
    belt.update(40, -28, 200);
    expect(belt.snapshot.visible).toBe(true);
    belt.update(40, -20, 200);
    expect(belt.snapshot.visible).toBe(true);

    // fecha somente quando pitch sobe acima de -20°
    belt.update(40, -19, 50);
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

    // enquanto visível, mover a cabeça horizontalmente para -45° não altera o yaw do cinto
    belt.update(-45, -34, 200);
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

    // avança 2 segundos (ainda dentro da janela de 3 s) e confirma
    belt.update(0, -35, 2000);
    expect(belt.snapshot.exitConfirmPending).toBe(true);
    expect(belt.triggerExitAction()).toBe('confirmed');
    expect(belt.snapshot.exitConfirmPending).toBe(false);

    // se expirar os 3 segundos, exige nova confirmação
    expect(belt.triggerExitAction()).toBe('confirm-pending');
    belt.update(0, -35, 3100);
    expect(belt.snapshot.exitConfirmPending).toBe(false);
    expect(belt.triggerExitAction()).toBe('confirm-pending');
  });

  it('places at most 8 belt items on an arc at pitch -38° within +-40° and disables ai-assistant', () => {
    const placements = computeBeltItemPlacements();
    expect(placements.length).toBeLessThanOrEqual(BELT_MAX_ITEMS);
    expect(placements).toHaveLength(8);
    expect(placements.some((p) => p.id === 'toggle-theme')).toBe(true);
    expect(placements.some((p) => p.id === 'open-contents')).toBe(true);

    for (const item of placements) {
      expect(item.pitchDeg).toBe(BELT_CENTER_PITCH_DEG);
      expect(Math.abs(item.yawOffsetDeg)).toBeLessThanOrEqual(BELT_ARC_MAX_HALF_WIDTH_DEG);
      expect(item.disabled).toBe(item.id === 'ai-assistant');
    }
  });
});

describe('Phase 5 — PomodoroSystem timer with fake clock', () => {
  it('supports 25/5 and 20/5 presets, pause/resume, 1-min warning, and break transition', () => {
    const pomodoro = new PomodoroSystem('25/5');
    expect(pomodoro.snapshot.phase).toBe('idle');
    expect(pomodoro.snapshot.remainingMs).toBe(POMODORO_FOCUS_25_MS);
    expect(formatPomodoroMmSs(pomodoro.snapshot.remainingMs)).toBe('25:00');

    // inicia o foco
    pomodoro.toggle();
    expect(pomodoro.snapshot.phase).toBe('focus');

    // avança até faltar 1 minuto e 1 segundo (23m59s decorridos)
    const beforeWarn = pomodoro.step(23 * 60 * 1000 + 59 * 1000);
    expect(beforeWarn.warningJustTriggered).toBe(false);
    expect(pomodoro.snapshot.oneMinuteWarningActive).toBe(false);

    // avança mais 1 segundo -> entra em <= 60s e dispara o aviso uma única vez
    const atWarn = pomodoro.step(1000);
    expect(atWarn.warningJustTriggered).toBe(true);
    expect(pomodoro.snapshot.oneMinuteWarningActive).toBe(true);
    expect(formatPomodoroMmSs(pomodoro.snapshot.remainingMs)).toBe('01:00');

    // pausa e verifica que o tempo não corre enquanto pausado
    pomodoro.toggle();
    expect(pomodoro.snapshot.phase).toBe('paused');
    pomodoro.step(30_000);
    expect(pomodoro.snapshot.remainingMs).toBe(60_000);

    // retoma e conclui o bloco de foco -> entra na pausa de 5 minutos
    pomodoro.toggle();
    expect(pomodoro.snapshot.phase).toBe('focus');
    const endFocus = pomodoro.step(60_000);
    expect(endFocus.breakJustStarted).toBe(true);
    expect(pomodoro.snapshot.phase).toBe('break');
    expect(pomodoro.snapshot.completedBlocks).toBe(1);
    expect(pomodoro.snapshot.remainingMs).toBe(POMODORO_BREAK_5_MS);

    // conclui os 5 minutos de pausa -> retorna ao estado idle pronto para o próximo bloco
    const endBreak = pomodoro.step(POMODORO_BREAK_5_MS);
    expect(endBreak.breakJustEnded).toBe(true);
    expect(pomodoro.snapshot.phase).toBe('idle');

    // troca preset para 20/5 em idle
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

    // quando todos os painéis estão na distância mínima (0.55 m), o espaçamento aumenta automaticamente para evitar sobreposição
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
