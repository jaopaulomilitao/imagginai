import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_CAMERA_VFOV_DEG,
  MODE_TRANSITION_DURATION_MS,
  PASSTHROUGH_PLANE_DISTANCE_M,
} from './config/constants';
import { formatDebugText, FpsMeter, parseZoneParams } from './config/zone-params';
import { calcPassthroughPlaneSize } from './systems/calibration-math';
import { FlashcardStateMachine, formatCardCitation } from './systems/flashcard-state';
import { ModeController } from './systems/mode-controller';

describe('passthrough plane-size math (section 3.7)', () => {
  it('computes head-locked plane size from camera vertical fov in landscape', () => {
    const plane = calcPassthroughPlaneSize(
      1280,
      720,
      DEFAULT_CAMERA_VFOV_DEG,
      PASSTHROUGH_PLANE_DISTANCE_M,
    );

    // h = 2 * d * tan(camVFovDeg / 2), w = h * (1280 / 720)
    const expectedHeight =
      2 * PASSTHROUGH_PLANE_DISTANCE_M * Math.tan(((DEFAULT_CAMERA_VFOV_DEG / 2) * Math.PI) / 180);
    const expectedWidth = expectedHeight * (1280 / 720);

    expect(plane.distanceM).toBe(1.0);
    expect(plane.heightM).toBeCloseTo(expectedHeight, 6);
    expect(plane.widthM).toBeCloseTo(expectedWidth, 6);
  });

  it('scales linearly with plane distance and preserves aspect ratio on portrait rotation', () => {
    const landscape = calcPassthroughPlaneSize(1280, 720, 50, 1.0);
    const portrait = calcPassthroughPlaneSize(720, 1280, 50, 1.0);
    const twoMeters = calcPassthroughPlaneSize(1280, 720, 50, 2.0);

    expect(landscape.widthM).toBeCloseTo(portrait.heightM, 6);
    expect(landscape.heightM).toBeCloseTo(portrait.widthM, 6);
    expect(twoMeters.widthM).toBeCloseTo(landscape.widthM * 2, 6);
    expect(twoMeters.heightM).toBeCloseTo(landscape.heightM * 2, 6);
  });

  it('rejects non-positive video dimensions or plane distance', () => {
    expect(() => calcPassthroughPlaneSize(0, 720)).toThrow(RangeError);
    expect(() => calcPassthroughPlaneSize(1280, -1)).toThrow(RangeError);
    expect(() => calcPassthroughPlaneSize(1280, 720, 50, 0)).toThrow(RangeError);
  });
});

describe('ModeController state machine (section 3.7)', () => {
  it('starts in focus mode with passthrough hidden and environment visible', () => {
    const controller = new ModeController();
    expect(controller.mode).toBe('focus');
    expect(controller.snapshot).toEqual({
      mode: 'focus',
      targetMode: 'focus',
      transitioning: false,
      passthroughOpacity: 0,
      environmentOpacity: 1,
      environmentVisible: true,
    });
  });

  it('fades smoothly over 300 ms from focus to passthrough without abrupt flash', () => {
    const controller = new ModeController('focus', MODE_TRANSITION_DURATION_MS);
    const started = controller.toggle();
    expect(started.targetMode).toBe('passthrough');
    expect(started.transitioning).toBe(true);
    expect(started.passthroughOpacity).toBe(0);
    expect(started.environmentOpacity).toBe(1);
    expect(started.environmentVisible).toBe(true);

    // metade da transição (150 ms)
    const halfway = controller.step(150);
    expect(halfway.transitioning).toBe(true);
    expect(halfway.passthroughOpacity).toBeCloseTo(0.5, 5);
    expect(halfway.environmentOpacity).toBeCloseTo(0.5, 5);
    expect(halfway.environmentVisible).toBe(true);

    // fim da transição (300 ms): céu fica invisível apenas quando opacidade chega a 0
    const done = controller.step(150);
    expect(done.mode).toBe('passthrough');
    expect(done.targetMode).toBe('passthrough');
    expect(done.transitioning).toBe(false);
    expect(done.passthroughOpacity).toBe(1);
    expect(done.environmentOpacity).toBe(0);
    expect(done.environmentVisible).toBe(false);
  });

  it('reverses smoothly mid-transition in proportional time', () => {
    const controller = new ModeController('focus', 300);
    controller.toggle();
    // avança 100 ms (1/3 do caminho -> opacidade 1/3)
    const partial = controller.step(100);
    expect(partial.passthroughOpacity).toBeCloseTo(1 / 3, 5);

    // inverte de volta para foco a partir de 1/3; deve levar 100 ms para retornar a 0
    controller.toggle();
    expect(controller.targetMode).toBe('focus');

    const midReturn = controller.step(50);
    expect(midReturn.transitioning).toBe(true);
    expect(midReturn.passthroughOpacity).toBeCloseTo(1 / 6, 5);

    const finished = controller.step(50);
    expect(finished.mode).toBe('focus');
    expect(finished.transitioning).toBe(false);
    expect(finished.passthroughOpacity).toBe(0);
    expect(finished.environmentOpacity).toBe(1);
    expect(finished.environmentVisible).toBe(true);
  });

  it('notifies subscribers on mode changes and steps, and supports unsubscribe', () => {
    const controller = new ModeController('focus', 300);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    controller.setMode('passthrough');
    controller.step(300);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    controller.toggle();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects non-positive transition durations', () => {
    expect(() => new ModeController('focus', 0)).toThrow(RangeError);
    expect(() => new ModeController('focus', -10)).toThrow(RangeError);
  });
});

describe('zone runtime params and debug helpers', () => {
  it('parses ?debug=1 and ?env=focus-nature with safe defaults', () => {
    expect(parseZoneParams('')).toEqual({
      debug: false,
      environment: 'focus-dark',
      zoneId: 'zone-demo',
    });
    expect(parseZoneParams('?debug=1&env=focus-nature&zoneId=zone-custom')).toEqual({
      debug: true,
      environment: 'focus-nature',
      zoneId: 'zone-custom',
    });
    expect(parseZoneParams('?debug=0&env=invalid-preset')).toEqual({
      debug: false,
      environment: 'focus-dark',
      zoneId: 'zone-demo',
    });
  });

  it('computes smoothed fps and formats debug overlay text', () => {
    const meter = new FpsMeter(0.5);
    expect(meter.recordFrame(16.6667)).toBeCloseTo(60, 0);
    expect(meter.recordFrame(20)).toBeCloseTo(55, 0);

    const line = formatDebugText({
      fps: 58.2,
      inferenceHz: 18.6,
      targetHz: 20,
      latencyMs: 24.3,
      mode: 'passthrough',
    });
    expect(line).toBe('FPS: 58 | Hand: 18.6/20 Hz (24 ms) | Mode: passthrough');
  });
});

describe('FlashcardStateMachine interactive reveal and hide', () => {
  it('formats verified citation strings correctly', () => {
    expect(formatCardCitation('Material de estudo', 3)).toBe('Material de estudo | Pág. 3');
    expect(
      formatCardCitation(
        'Um título extremamente longo que excede trinta e quatro caracteres',
        12,
      ),
    ).toBe('Um título extremamente longo qu... | Pág. 12');
  });

  it('initializes in hidden (front) state with only title visible and reveal button', () => {
    const sm = new FlashcardStateMachine({
      title: 'Lei de Ohm',
      body: 'A corrente é proporcional à diferença de potencial elétrico.',
      sourcePage: 4,
      sourceTitle: 'Física II',
      accentColor: '#0284C7',
    });

    expect(sm.isRevealed).toBe(false);
    expect(sm.getCenterText()).toBe('Lei de Ohm');
    expect(sm.getButtonLabel()).toBe('Revelar');
    expect(sm.getBadgeText()).toBe('FLASHCARD');
    expect(sm.getCitation()).toBe('Física II | Pág. 4');

    // alterna para revelado: centro exibe a descrição e botão muda para Ocultar
    sm.toggle();
    expect(sm.isRevealed).toBe(true);
    expect(sm.getCenterText()).toBe('A corrente é proporcional à diferença de potencial elétrico.');
    expect(sm.getButtonLabel()).toBe('Ocultar');
    expect(sm.getBadgeText()).toBe('Lei de Ohm');

    // alterna de volta para oculto: centro volta a exibir apenas o título
    sm.toggle();
    expect(sm.isRevealed).toBe(false);
    expect(sm.getCenterText()).toBe('Lei de Ohm');
    expect(sm.getButtonLabel()).toBe('Revelar');

    sm.reveal();
    expect(sm.isRevealed).toBe(true);

    sm.hide();
    expect(sm.isRevealed).toBe(false);
  });
});

