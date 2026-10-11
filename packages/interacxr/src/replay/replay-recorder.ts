import type { HandLandmarks, Landmark } from '../core/landmarks';
import {
  LANDMARK_SESSION_VERSION,
  type LandmarkSession,
  type LandmarkSessionFrame,
} from './landmark-session';

// casas decimais preservadas: suficiente para a precisão do mediapipe e reduz o tamanho do json
const COORDINATE_DECIMALS = 4;
const ROUNDING = 10 ** COORDINATE_DECIMALS;

function round(value: number): number {
  return Math.round(value * ROUNDING) / ROUNDING;
}

function roundLandmark(landmark: Landmark): Landmark {
  return { x: round(landmark.x), y: round(landmark.y), z: round(landmark.z) };
}

// grava quadros de pontos da mão em memória; a exportação fica a cargo de quem usa (uso local)
export class ReplayRecorder {
  private frames: LandmarkSessionFrame[] = [];
  private recording = false;
  private startMs: number | null = null;

  get isRecording(): boolean {
    return this.recording;
  }

  start(): void {
    this.frames = [];
    this.recording = true;
    this.startMs = null;
  }

  record(landmarks: HandLandmarks | null, timestampMs: number): void {
    if (!this.recording) return;
    // o relógio relativo é fixado no primeiro quadro recebido
    this.startMs ??= timestampMs;
    this.frames.push({
      tMs: Math.max(0, Math.round(timestampMs - this.startMs)),
      landmarks: landmarks ? landmarks.map(roundLandmark) : null,
    });
  }

  stop(name: string, description?: string): LandmarkSession {
    const session: LandmarkSession = {
      version: LANDMARK_SESSION_VERSION,
      name,
      frames: this.frames,
    };
    if (description) session.description = description;
    this.frames = [];
    this.recording = false;
    this.startMs = null;
    return session;
  }
}
