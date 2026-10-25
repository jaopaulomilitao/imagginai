/// <reference lib="webworker" />
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

import type { WorkerInitRequest, WorkerRequest, WorkerResponse } from './worker-protocol';

declare const self: DedicatedWorkerGlobalScope;

let handLandmarker: HandLandmarker | null = null;

function post(message: WorkerResponse): void {
  self.postMessage(message);
}

async function initializeModel(request: WorkerInitRequest): Promise<void> {
  // o carregador em módulo es6 define globalThis.ModuleFactory via import dinâmico,
  // o que dispensa importScripts (indisponível em module workers) e qualquer eval
  const vision = await FilesetResolver.forVisionTasks(request.wasmBaseUrl, true);

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: request.modelUrl, delegate: request.delegate },
    runningMode: 'VIDEO',
    numHands: request.maxHands,
  });

  post({ type: 'READY' });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  if (request.type === 'INIT') {
    try {
      await initializeModel(request);
    } catch (error) {
      post({ type: 'ERROR', message: describeError(error) });
    }
    return;
  }

  if (!handLandmarker) {
    // o quadro é descartado, mas a resposta libera o pipeline da thread principal
    request.image.close();
    post({ type: 'RESULT', landmarks: [] });
    return;
  }

  const results = handLandmarker.detectForVideo(request.image, request.timestamp);
  // é liberada a memória do bitmap imediatamente
  request.image.close();

  const hands = results.landmarks.map((lm, idx) => {
    const cat = results.handedness?.[idx]?.[0] ?? results.handednesses?.[idx]?.[0];
    const catName = cat?.categoryName?.toLowerCase();
    const handedness: 'left' | 'right' =
      catName === 'left' ? 'left' : catName === 'right' ? 'right' : idx === 0 ? 'right' : 'left';
    return {
      landmarks: lm,
      handedness,
      score: cat?.score ?? 1.0,
    };
  });

  post({ type: 'RESULT', landmarks: results.landmarks, hands });
};
