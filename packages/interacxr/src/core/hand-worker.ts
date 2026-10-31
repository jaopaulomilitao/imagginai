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
    minHandDetectionConfidence: 0.45,
    minHandPresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
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
    // correspondência direta do rótulo do mediapipe (usada apenas quando há uma única mão)
    const handedness: 'left' | 'right' =
      catName === 'left' ? 'left' : catName === 'right' ? 'right' : idx === 0 ? 'right' : 'left';
    return {
      landmarks: lm,
      handedness,
      score: cat?.score ?? 1.0,
    };
  });

  // com duas mãos, a atribuição é geométrica e não depende do rótulo do mediapipe:
  // na câmera traseira (sem espelhamento) a mão direita física aparece à direita da imagem (x maior)
  if (hands.length >= 2 && hands[0] && hands[1]) {
    const wrist0X = hands[0].landmarks[0]?.x ?? 0;
    const wrist1X = hands[1].landmarks[0]?.x ?? 1;
    const firstIsRight = wrist0X > wrist1X;
    hands[0].handedness = firstIsRight ? 'right' : 'left';
    hands[1].handedness = firstIsRight ? 'left' : 'right';
  }

  post({ type: 'RESULT', landmarks: results.landmarks, hands });
};
