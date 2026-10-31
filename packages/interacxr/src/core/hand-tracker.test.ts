import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_HAND_TRACKER_OPTIONS,
  type HandFrame,
  HandTracker,
  type HandTrackerDependencies,
} from './hand-tracker';
import type { Landmark } from './landmarks';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

class FakeWorker {
  readonly requests: WorkerRequest[] = [];
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  terminated = false;

  postMessage(request: WorkerRequest): void {
    this.requests.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: WorkerResponse): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>);
  }

  processRequests(): WorkerRequest[] {
    return this.requests.filter((request) => request.type === 'PROCESS');
  }
}

const HAND: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

function setup() {
  let now = 0;
  const worker = new FakeWorker();
  const captureFrame = vi.fn<HandTrackerDependencies['captureFrame']>(() =>
    Promise.resolve({ close: vi.fn() } as unknown as ImageBitmap),
  );
  const video = { readyState: 4, currentTime: 0 } as HTMLVideoElement;
  const tracker = new HandTracker(
    { ...DEFAULT_HAND_TRACKER_OPTIONS, wasmBaseUrl: 'http://x/wasm', modelUrl: 'http://x/m' },
    { createWorker: () => worker as unknown as Worker, captureFrame, now: () => now },
  );
  tracker.start(video);
  const advance = (ms: number) => {
    now += ms;
    (video as { currentTime: number }).currentTime += ms / 1000;
  };
  return { worker, tracker, captureFrame, advance };
}

describe('HandTracker', () => {
  it('initializes the worker with local model urls', () => {
    const { worker } = setup();

    expect(worker.requests[0]).toMatchObject({ type: 'INIT', modelUrl: 'http://x/m' });
  });

  it('does not send frames before the model is ready', async () => {
    const { worker, tracker } = setup();

    tracker.pump();
    await Promise.resolve();

    expect(worker.processRequests()).toHaveLength(0);
  });

  it('captures frames at 480 px and keeps a single frame in flight', async () => {
    const { worker, tracker, captureFrame, advance } = setup();
    worker.reply({ type: 'READY' });

    tracker.pump();
    await Promise.resolve();
    advance(100);
    tracker.pump();
    await Promise.resolve();

    expect(captureFrame).toHaveBeenCalledTimes(1);
    expect(captureFrame.mock.calls[0]?.[1]).toBe(480);
    expect(worker.processRequests()).toHaveLength(1);
  });

  it('skips a video frame that was already processed', async () => {
    const { worker, tracker } = setup();
    worker.reply({ type: 'READY' });
    tracker.pump();
    await Promise.resolve();
    worker.reply({ type: 'RESULT', landmarks: [] });

    tracker.pump();
    await Promise.resolve();

    expect(worker.processRequests()).toHaveLength(1);
  });

  it('publishes results with latency and frees the pipeline', async () => {
    const { worker, tracker, advance } = setup();
    const frames: HandFrame[] = [];
    tracker.onFrame((frame) => frames.push(frame));
    worker.reply({ type: 'READY' });
    tracker.pump();
    await Promise.resolve();

    advance(30);
    worker.reply({ type: 'RESULT', landmarks: [HAND] });
    advance(30);
    tracker.pump();
    await Promise.resolve();

    expect(frames[0]?.landmarks).toBe(HAND);
    expect(frames[0]?.latencyMs).toBe(30);
    expect(worker.processRequests()).toHaveLength(2);
  });

  it('slows down to the idle rate when no hand is seen for 2 s', async () => {
    const { worker, tracker, advance } = setup();
    worker.reply({ type: 'READY' });
    advance(2100);

    expect(tracker.stats.targetHz).toBe(5);
  });

  it('ignores a second start with the same video', () => {
    const { tracker } = setup();
    const video = { readyState: 4, currentTime: 0, requestVideoFrameCallback: vi.fn(() => 1) };

    tracker.start(video as unknown as HTMLVideoElement);
    tracker.start(video as unknown as HTMLVideoElement);

    expect(video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker on dispose', () => {
    const { worker, tracker } = setup();

    tracker.dispose();

    expect(worker.terminated).toBe(true);
  });

  it('publishes both left and right hands while keeping the right hand as primary', async () => {
    const { worker, tracker, advance } = setup();
    const frames: HandFrame[] = [];
    tracker.onFrame((frame) => frames.push(frame));
    worker.reply({ type: 'READY' });
    tracker.pump();
    await Promise.resolve();

    const leftHand: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.25, y: 0.5, z: 0 }));
    const rightHand: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0.75, y: 0.5, z: 0 }));

    advance(25);
    worker.reply({
      type: 'RESULT',
      landmarks: [leftHand, rightHand],
      hands: [
        { landmarks: leftHand, handedness: 'left', score: 0.98 },
        { landmarks: rightHand, handedness: 'right', score: 0.99 },
      ],
    });

    expect(frames[0]?.hands).toHaveLength(2);
    expect(frames[0]?.hands?.[0]?.handedness).toBe('left');
    expect(frames[0]?.hands?.[1]?.handedness).toBe('right');
    expect(frames[0]?.landmarks).toBe(rightHand);

    // quando apenas uma mão está visível, ela assume clique/movimento (fallback de mão única)
    advance(25);
    tracker.pump();
    await Promise.resolve();
    worker.reply({
      type: 'RESULT',
      landmarks: [leftHand],
      hands: [{ landmarks: leftHand, handedness: 'left', score: 0.98 }],
    });
    expect(frames[1]?.hands).toHaveLength(1);
    expect(frames[1]?.hands?.[0]?.handedness).toBe('left');
    expect(frames[1]?.landmarks).toBe(leftHand);
  });
});
