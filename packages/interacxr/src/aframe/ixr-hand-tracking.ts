import AFRAME, { type Component, type Entity } from 'aframe';

import '../core/globals';
import HandWorker from '../core/hand-worker.ts?worker&inline';
import type { HandDataDetail } from '../core/landmarks';
import { logger } from '../core/logger';
import {
  DEFAULT_MODEL_PATH,
  DEFAULT_WASM_PATH,
  type InferenceDelegate,
  type WorkerRequest,
  type WorkerResponse,
} from '../core/worker-protocol';

interface HandTrackingData {
  maxHands: number;
  delegate: InferenceDelegate;
}

export interface HandTrackingComponent extends Component<HandTrackingData> {
  controller?: HandTrackingController;
}

const HAVE_CURRENT_DATA = 2;

export class HandTrackingController {
  private isProcessing = false;
  private videoElement: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private readonly worker: Worker;

  constructor(
    private readonly el: Entity,
    data: HandTrackingData,
  ) {
    // a calibração agora baseia-se num plano físico em metros, ignorando o fov virtual
    window.ixrCalibration = { baseDepth: 0.5, planeWidth: 0.8, planeHeight: 0.45 };

    this.worker = new HandWorker();
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) =>
      this.onWorkerMessage(event.data);
    this.post({
      type: 'INIT',
      maxHands: data.maxHands,
      delegate: data.delegate,
      wasmBaseUrl: new URL(DEFAULT_WASM_PATH, location.origin).href,
      modelUrl: new URL(DEFAULT_MODEL_PATH, location.origin).href,
    });
  }

  async startTracking(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      const video = document.createElement('video');
      video.srcObject = this.stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.onloadedmetadata = () => void this.onVideoReady(video);
      this.videoElement = video;
    } catch (error) {
      logger.error('camera init failed', error);
    }
  }

  async tick(time: number): Promise<void> {
    const video = this.videoElement;
    if (!video || this.isProcessing || video.readyState < HAVE_CURRENT_DATA) return;

    this.isProcessing = true;
    try {
      const bitmap = await createImageBitmap(video);
      const request: WorkerRequest = { type: 'PROCESS', image: bitmap, timestamp: time };
      this.worker.postMessage(request, [bitmap]);
    } catch (error) {
      logger.warn('frame skipped', error);
      this.isProcessing = false;
    }
  }

  dispose(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.worker.terminate();
    this.videoElement = null;
    this.stream = null;
  }

  private async onVideoReady(video: HTMLVideoElement): Promise<void> {
    // o aspecto é forçado para paisagem para corresponder ao uso do óculos vr
    const longSide = Math.max(video.videoWidth, video.videoHeight);
    const shortSide = Math.min(video.videoWidth, video.videoHeight);
    const aspect = longSide / shortSide;
    // um quadro de 45 centímetros de altura é projetado a 0.5m de distância
    if (window.ixrCalibration) {
      window.ixrCalibration.planeHeight = 0.45;
      window.ixrCalibration.planeWidth = 0.45 * aspect;
    }
    await video.play();
    await this.el.sceneEl.enterVR();
  }

  private onWorkerMessage(message: WorkerResponse): void {
    if (message.type === 'ERROR') {
      logger.error('hand worker failed', message.message);
      return;
    }
    if (message.type !== 'RESULT') return;
    const detail: HandDataDetail = { landmarks: message.landmarks[0] ?? null };
    this.el.emit('ixr-hand-data', detail);
    this.isProcessing = false;
  }

  private post(message: WorkerRequest): void {
    this.worker.postMessage(message);
  }
}

AFRAME.registerComponent<HandTrackingComponent>('ixr-hand-tracking', {
  schema: {
    maxHands: { type: 'int', default: 1 },
    delegate: { type: 'string', default: 'GPU', oneOf: ['CPU', 'GPU'] },
  },
  init() {
    this.controller = new HandTrackingController(this.el, this.data);
  },
  tick(time) {
    void this.controller?.tick(time);
  },
  remove() {
    this.controller?.dispose();
  },
});
