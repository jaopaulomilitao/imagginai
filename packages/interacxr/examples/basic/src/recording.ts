import type { Entity, Scene } from 'aframe';
import {
  HAND_DATA_EVENT,
  type HandDataDetail,
  type HandTrackingComponent,
  type HandTrackerStats,
  type LandmarkSession,
  ReplayRecorder,
} from 'interacxr';

// gravação local de pontos da mão para calibrar a pinça com dados reais (?record=<segundos>);
// o arquivo só sai do aparelho se o próprio usuário baixá-lo
const MIN_SECONDS = 5;
const MAX_SECONDS = 120;
const MS_PER_SECOND = 1000;

export interface RecordingResult {
  session: LandmarkSession;
  stats: HandTrackerStats | null;
  detectedPinches: number;
}

export function readRecordSeconds(search: string): number | null {
  const raw = new URLSearchParams(search).get('record');
  if (raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) return null;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds));
}

function trackerStats(camera: Entity): HandTrackerStats | null {
  const tracking = camera.components['ixr-hand-tracking'] as HandTrackingComponent | undefined;
  return tracking?.controller?.tracker.stats ?? null;
}

export function recordHand(camera: Entity, seconds: number): Promise<RecordingResult> {
  const recorder = new ReplayRecorder();
  let detectedPinches = 0;
  const onHandData = (event: Event): void => {
    const detail = (event as CustomEvent<HandDataDetail>).detail;
    recorder.record(detail.landmarks, detail.timestampMs);
  };
  const onPinch = (): void => {
    detectedPinches++;
  };
  recorder.start();
  camera.addEventListener(HAND_DATA_EVENT, onHandData);
  camera.addEventListener('ixr-pinch-start', onPinch);

  return new Promise((resolve) => {
    setTimeout(() => {
      camera.removeEventListener(HAND_DATA_EVENT, onHandData);
      camera.removeEventListener('ixr-pinch-start', onPinch);
      const stats = trackerStats(camera);
      const session = recorder.stop(
        `device-${new Date().toISOString().replace(/[:.]/g, '-')}`,
        `real hand recorded for ${seconds} s on ${navigator.userAgent}`,
      );
      resolve({ session, stats, detectedPinches });
    }, seconds * MS_PER_SECOND);
  });
}

function formatStats(result: RecordingResult): string {
  const frames = result.session.frames;
  const withHand = frames.filter((frame) => frame.landmarks !== null).length;
  const stats = result.stats;
  const rate = stats ? `${stats.measuredHz.toFixed(1)} Hz` : 'n/a';
  const latency = stats ? `${stats.meanLatencyMs.toFixed(0)} ms` : 'n/a';
  return [
    `frames: ${frames.length} (hand visible in ${withHand})`,
    `inference rate: ${rate}`,
    `mean latency: ${latency}`,
    `pinches detected: ${result.detectedPinches}`,
  ].join('\n');
}

export async function showRecording(scene: Scene, result: RecordingResult): Promise<void> {
  if (scene.is('vr-mode')) await scene.exitVR();
  const panel = document.querySelector<HTMLElement>('#record-panel');
  const summary = document.querySelector<HTMLElement>('#record-summary');
  const link = document.querySelector<HTMLAnchorElement>('#record-download');
  if (!panel || !summary || !link) return;
  summary.textContent = formatStats(result);
  const blob = new Blob([JSON.stringify(result.session)], { type: 'application/json' });
  link.href = URL.createObjectURL(blob);
  link.download = `${result.session.name}.json`;
  panel.hidden = false;
}
