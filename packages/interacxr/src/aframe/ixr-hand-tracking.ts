import AFRAME, { type Component, type Entity } from 'aframe';

import HandWorker from '../core/hand-worker.ts?worker&inline';
import {
  browserFrameCapture,
  DEFAULT_HAND_TRACKER_OPTIONS,
  type HandFrame,
  HandTracker,
} from '../core/hand-tracker';
import type { HandDataDetail } from '../core/landmarks';
import { logger } from '../core/logger';
import {
  DEFAULT_MODEL_PATH,
  DEFAULT_WASM_PATH,
  type InferenceDelegate,
} from '../core/worker-protocol';
import { getInteracxrSystem } from './interacxr-system';

interface HandTrackingData {
  maxHands: number;
  delegate: InferenceDelegate;
  inputWidth: number;
}

export interface HandTrackingComponent extends Component<HandTrackingData> {
  controller?: HandTrackingController;
}

export const HAND_DATA_EVENT = 'ixr-hand-data';

export class HandTrackingController {
  readonly tracker: HandTracker;

  constructor(
    private readonly el: Entity,
    data: HandTrackingData,
  ) {
    this.tracker = new HandTracker(
      {
        ...DEFAULT_HAND_TRACKER_OPTIONS,
        maxHands: data.maxHands,
        delegate: data.delegate,
        inputWidth: data.inputWidth,
        // urls absolutas, pois o worker embutido não resolve caminhos relativos
        wasmBaseUrl: new URL(DEFAULT_WASM_PATH, location.origin).href,
        modelUrl: new URL(DEFAULT_MODEL_PATH, location.origin).href,
      },
      {
        createWorker: () => new HandWorker(),
        captureFrame: browserFrameCapture,
        now: () => performance.now(),
      },
    );
    this.tracker.onFrame((frame) => this.emitHandData(frame));
  }

  async startTracking(): Promise<void> {
    try {
      // o vídeo é o mesmo usado pelo passthrough (camera service compartilhado)
      // o plano de projeção é recalculado pelo sistema com as dimensões reais do vídeo
      const video = await getInteracxrSystem(this.el).startCamera();
      this.tracker.start(video);
      await this.el.sceneEl.enterVR();
    } catch (error) {
      logger.error('camera init failed', error);
    }
  }

  // o tick do a-frame continua ativo em sessão imersiva e complementa o requestVideoFrameCallback
  tick(): void {
    this.tracker.pump();
  }

  dispose(): void {
    this.tracker.dispose();
  }

  private emitHandData(frame: HandFrame): void {
    const detail: HandDataDetail = { landmarks: frame.landmarks, timestampMs: frame.timestampMs };
    this.el.emit(HAND_DATA_EVENT, detail);
  }
}

AFRAME.registerComponent<HandTrackingComponent>('ixr-hand-tracking', {
  schema: {
    maxHands: { type: 'int', default: 1 },
    delegate: { type: 'string', default: 'GPU', oneOf: ['CPU', 'GPU'] },
    inputWidth: { type: 'int', default: DEFAULT_HAND_TRACKER_OPTIONS.inputWidth },
  },
  init() {
    this.controller = new HandTrackingController(this.el, this.data);
  },
  tick() {
    this.controller?.tick();
  },
  remove() {
    this.controller?.dispose();
  },
});
