import type { HandLandmarks } from './landmarks';

export type InferenceDelegate = 'CPU' | 'GPU';

export interface WorkerInitRequest {
  type: 'INIT';
  maxHands: number;
  delegate: InferenceDelegate;
  // urls absolutas, pois o worker embutido (blob) não resolve caminhos relativos
  wasmBaseUrl: string;
  modelUrl: string;
}

export interface WorkerProcessRequest {
  type: 'PROCESS';
  image: ImageBitmap;
  timestamp: number;
}

export type WorkerRequest = WorkerInitRequest | WorkerProcessRequest;

export interface WorkerReadyResponse {
  type: 'READY';
}

export interface WorkerResultResponse {
  type: 'RESULT';
  landmarks: HandLandmarks[];
}

export interface WorkerErrorResponse {
  type: 'ERROR';
  message: string;
}

export type WorkerResponse = WorkerReadyResponse | WorkerResultResponse | WorkerErrorResponse;

// arquivos servidos localmente pela aplicação em /mediapipe/ (seção 2.3)
export const DEFAULT_WASM_PATH = '/mediapipe/wasm';
export const DEFAULT_MODEL_PATH = '/mediapipe/hand_landmarker.task';
