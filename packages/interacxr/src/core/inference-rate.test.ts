import { describe, expect, it } from 'vitest';

import {
  DEFAULT_INFERENCE_RATE,
  ECONOMY_INFERENCE_HZ,
  InferenceRateController,
} from './inference-rate';

// são simulados quadros de vídeo a 60 fps e medida a frequência entre o primeiro e o último envio
function measureHz(
  controller: InferenceRateController,
  fromMs: number,
  toMs: number,
  handPresent: boolean,
): number {
  const frameMs = 1000 / 60;
  const processedAt: number[] = [];
  for (let frame = 0; fromMs + frame * frameMs < toMs; frame++) {
    const now = fromMs + frame * frameMs;
    controller.reportHand(handPresent, now);
    if (controller.shouldProcess(now)) {
      controller.markProcessed(now);
      processedAt.push(now);
    }
  }
  const first = processedAt[0] ?? 0;
  const last = processedAt.at(-1) ?? 0;
  return ((processedAt.length - 1) / (last - first)) * 1000;
}

describe('InferenceRateController', () => {
  it('runs at 15–20 Hz while a hand is present', () => {
    const hz = measureHz(new InferenceRateController(0), 0, 3000, true);

    expect(hz).toBeGreaterThanOrEqual(15);
    expect(hz).toBeLessThanOrEqual(20.5);
  });

  it('drops to 5 Hz after more than 2 s without a hand', () => {
    const controller = new InferenceRateController(0);

    expect(controller.targetHz(2000)).toBe(DEFAULT_INFERENCE_RATE.activeHz);
    expect(controller.targetHz(2001)).toBe(DEFAULT_INFERENCE_RATE.idleHz);
    expect(measureHz(controller, 3000, 6000, false)).toBeCloseTo(5, 0);
  });

  it('returns to the active rate as soon as a hand is seen again', () => {
    const controller = new InferenceRateController(0);
    controller.reportHand(true, 5000);

    expect(controller.targetHz(5100)).toBe(DEFAULT_INFERENCE_RATE.activeHz);
  });

  it('caps the rate in economy mode without raising the idle rate', () => {
    const controller = new InferenceRateController(0);
    controller.setRateCap(ECONOMY_INFERENCE_HZ);

    expect(controller.targetHz(100)).toBe(ECONOMY_INFERENCE_HZ);
    expect(controller.targetHz(5000)).toBe(DEFAULT_INFERENCE_RATE.idleHz);
  });
});
