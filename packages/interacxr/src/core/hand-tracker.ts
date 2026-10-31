import {
  DEFAULT_INFERENCE_RATE,
  type InferenceRateConfig,
  InferenceRateController,
} from './inference-rate';
import type { HandLandmarks, TrackedHand } from './landmarks';
import { logger } from './logger';
import type { InferenceDelegate, WorkerRequest, WorkerResponse } from './worker-protocol';

export interface HandTrackerOptions {
  maxHands: number;
  delegate: InferenceDelegate;
  wasmBaseUrl: string;
  modelUrl: string;
  // largura do quadro enviado ao worker (seção 3.8); a altura segue a proporção do vídeo
  inputWidth: number;
  rate: InferenceRateConfig;
}

export interface HandFrame {
  landmarks: HandLandmarks | null;
  hands?: readonly TrackedHand[];
  timestampMs: number;
  latencyMs: number;
}

export type HandFrameListener = (frame: HandFrame) => void;

export interface HandTrackerStats {
  ready: boolean;
  targetHz: number;
  measuredHz: number;
  meanLatencyMs: number;
}

export interface HandTrackerDependencies {
  createWorker(): Worker;
  captureFrame(video: HTMLVideoElement, width: number): Promise<ImageBitmap>;
  now(): number;
}

export const DEFAULT_INPUT_WIDTH = 480;

const HAVE_CURRENT_DATA = 2;
// peso da média móvel exponencial usada nas estatísticas de desempenho
const STATS_SMOOTHING = 0.1;

export const browserFrameCapture = (video: HTMLVideoElement, width: number) =>
  createImageBitmap(video, { resizeWidth: width, resizeQuality: 'low' });

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback(callback: () => void): number;
  cancelVideoFrameCallback(handle: number): void;
};

function supportsFrameCallback(video: HTMLVideoElement): video is VideoWithFrameCallback {
  return 'requestVideoFrameCallback' in video;
}

// envia quadros reduzidos ao worker do mediapipe em ritmo adaptativo e publica os resultados
export class HandTracker {
  private readonly worker: Worker;
  private readonly listeners = new Set<HandFrameListener>();
  private readonly rate: InferenceRateController;
  private video: HTMLVideoElement | null = null;
  private frameCallbackHandle: number | null = null;
  private ready = false;
  private busy = false;
  private sentAtMs = 0;
  private lastMediaTime = Number.NaN;
  private lastResultMs: number | null = null;
  private measuredHz = 0;
  private meanLatencyMs = 0;

  constructor(
    private readonly options: HandTrackerOptions,
    private readonly dependencies: HandTrackerDependencies,
  ) {
    this.rate = new InferenceRateController(dependencies.now(), options.rate);
    this.worker = dependencies.createWorker();
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onMessage(event.data);
    this.post({
      type: 'INIT',
      maxHands: options.maxHands,
      delegate: options.delegate,
      wasmBaseUrl: options.wasmBaseUrl,
      modelUrl: options.modelUrl,
    });
  }

  get stats(): HandTrackerStats {
    return {
      ready: this.ready,
      targetHz: this.rate.targetHz(this.dependencies.now()),
      measuredHz: this.measuredHz,
      meanLatencyMs: this.meanLatencyMs,
    };
  }

  onFrame(listener: HandFrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // idempotente: iniciar de novo com o mesmo vídeo não cria um segundo laço de quadros
  start(video: HTMLVideoElement): void {
    if (this.video === video) return;
    this.stop();
    this.video = video;
    this.scheduleFrameCallback();
  }

  stop(): void {
    if (this.video && this.frameCallbackHandle !== null && supportsFrameCallback(this.video)) {
      this.video.cancelVideoFrameCallback(this.frameCallbackHandle);
    }
    this.frameCallbackHandle = null;
    this.video = null;
  }

  setRateCap(hz: number | null): void {
    this.rate.setRateCap(hz);
  }

  // também pode ser chamado pelo tick do a-frame, pois o requestVideoFrameCallback
  // pode ser suspenso durante uma sessão webxr imersiva
  pump(): void {
    const video = this.video;
    const now = this.dependencies.now();
    if (!video || !this.ready || this.busy || video.readyState < HAVE_CURRENT_DATA) return;
    if (video.currentTime === this.lastMediaTime || !this.rate.shouldProcess(now)) return;

    this.busy = true;
    this.lastMediaTime = video.currentTime;
    this.rate.markProcessed(now);
    void this.sendFrame(video, now);
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.worker.terminate();
  }

  private scheduleFrameCallback(): void {
    const video = this.video;
    if (!video || !supportsFrameCallback(video)) return;
    this.frameCallbackHandle = video.requestVideoFrameCallback(() => {
      this.pump();
      this.scheduleFrameCallback();
    });
  }

  private async sendFrame(video: HTMLVideoElement, sentAtMs: number): Promise<void> {
    try {
      const image = await this.dependencies.captureFrame(video, this.options.inputWidth);
      this.sentAtMs = sentAtMs;
      this.post({ type: 'PROCESS', image, timestamp: sentAtMs }, [image]);
    } catch (error) {
      // o quadro é descartado e o pipeline liberado para a próxima tentativa
      logger.warn('frame capture failed', error);
      this.busy = false;
    }
  }

  private onMessage(message: WorkerResponse): void {
    if (message.type === 'READY') {
      this.ready = true;
    } else if (message.type === 'RESULT') {
      const hands: readonly TrackedHand[] =
        message.hands ??
        message.landmarks.map((lm, idx) => ({
          landmarks: lm,
          handedness: (idx === 0 ? 'right' : 'left') as 'left' | 'right',
          score: 1.0,
        }));
      // uma única mão visível sempre assume clique/movimento (nunca rotação);
      // com duas mãos, apenas a mão direita alimenta o detector de clique/movimento
      const primaryHand =
        hands.length === 1
          ? (hands[0]?.landmarks ?? null)
          : (hands.find((h) => h.handedness === 'right')?.landmarks ?? null);
      this.onResult(primaryHand, hands);
    } else {
      logger.error('hand worker failed', message.message);
      this.ready = false;
      this.listeners.forEach((listener) => listener(this.emptyFrame()));
    }
  }

  private onResult(landmarks: HandLandmarks | null, hands: readonly TrackedHand[] = []): void {
    const now = this.dependencies.now();
    this.busy = false;
    this.rate.reportHand(landmarks !== null || hands.length > 0, now);
    this.updateStats(now);
    const frame: HandFrame = {
      landmarks,
      hands,
      timestampMs: this.sentAtMs,
      latencyMs: now - this.sentAtMs,
    };
    this.listeners.forEach((listener) => listener(frame));
  }

  private updateStats(now: number): void {
    const latency = now - this.sentAtMs;
    this.meanLatencyMs += (latency - this.meanLatencyMs) * STATS_SMOOTHING;
    if (this.lastResultMs !== null && now > this.lastResultMs) {
      const instantHz = 1000 / (now - this.lastResultMs);
      this.measuredHz += (instantHz - this.measuredHz) * STATS_SMOOTHING;
    }
    this.lastResultMs = now;
  }

  private emptyFrame(): HandFrame {
    return { landmarks: null, timestampMs: this.dependencies.now(), latencyMs: 0 };
  }

  private post(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }
}

export const DEFAULT_HAND_TRACKER_OPTIONS: Omit<HandTrackerOptions, 'wasmBaseUrl' | 'modelUrl'> = {
  maxHands: 2,
  delegate: 'GPU',
  inputWidth: DEFAULT_INPUT_WIDTH,
  rate: DEFAULT_INFERENCE_RATE,
};
