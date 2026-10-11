import { DEFAULT_ONE_EURO, LandmarkSmoother, type OneEuroParams } from './filters';
import { type HandLandmarks, type Landmark, LANDMARK } from './landmarks';

export const POSE_NAMES = ['grab', 'victory', 'rock', 'point', 'pinch'] as const;

export type PoseName = (typeof POSE_NAMES)[number];

export type PoseFlags = Record<PoseName, boolean>;

export type PosePhase = 'start' | 'move' | 'end';

export interface PoseClassifierConfig {
  // a pinça começa abaixo desta razão (distância polegar–indicador / tamanho da mão)
  pinchStartRatio: number;
  // e só termina acima desta, criando histerese
  pinchEndRatio: number;
  // quadros consecutivos exigidos para confirmar uma mudança de pose
  confirmFrames: number;
  // null desativa a suavização temporal
  smoothing: OneEuroParams | null;
}

export const DEFAULT_POSE_CLASSIFIER_CONFIG: PoseClassifierConfig = {
  pinchStartRatio: 0.25,
  pinchEndRatio: 0.4,
  confirmFrames: 3,
  smoothing: DEFAULT_ONE_EURO,
};

export interface HandMetrics {
  // distância punho → ponto 9, usada para normalizar a pinça
  handSize: number;
  pinchRatio: number;
}

export interface PoseEvent {
  pose: PoseName;
  phase: PosePhase;
}

export interface PoseUpdate {
  events: PoseEvent[];
  // verdadeiro no quadro em que a ausência da mão é confirmada
  handLost: boolean;
  landmarks: HandLandmarks | null;
  metrics: HandMetrics | null;
}

const NO_POSES: PoseFlags = {
  grab: false,
  victory: false,
  rock: false,
  point: false,
  pinch: false,
};

function distance(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function landmarkAt(hand: HandLandmarks, index: number): Landmark {
  const landmark = hand[index];
  if (!landmark) throw new RangeError(`hand has no landmark ${index}`);
  return landmark;
}

function isExtended(hand: HandLandmarks, tip: number, pip: number): boolean {
  const wrist = landmarkAt(hand, LANDMARK.WRIST);
  return distance(landmarkAt(hand, tip), wrist) > distance(landmarkAt(hand, pip), wrist);
}

export function measureHand(hand: HandLandmarks): HandMetrics {
  const handSize = distance(
    landmarkAt(hand, LANDMARK.WRIST),
    landmarkAt(hand, LANDMARK.MIDDLE_MCP),
  );
  const pinchDistance = distance(
    landmarkAt(hand, LANDMARK.THUMB_TIP),
    landmarkAt(hand, LANDMARK.INDEX_TIP),
  );
  return { handSize, pinchRatio: handSize > 0 ? pinchDistance / handSize : Infinity };
}

// classificação instantânea de um quadro; a pinça depende do estado anterior (histerese)
export function classifyFrame(
  hand: HandLandmarks,
  wasPinching: boolean,
  config: PoseClassifierConfig = DEFAULT_POSE_CLASSIFIER_CONFIG,
): PoseFlags {
  const index = isExtended(hand, LANDMARK.INDEX_TIP, LANDMARK.INDEX_PIP);
  const middle = isExtended(hand, LANDMARK.MIDDLE_TIP, LANDMARK.MIDDLE_PIP);
  const ring = isExtended(hand, LANDMARK.RING_TIP, LANDMARK.RING_PIP);
  const pinky = isExtended(hand, LANDMARK.PINKY_TIP, LANDMARK.PINKY_PIP);

  const grab = !index && !middle && !ring && !pinky;
  const rock = index && pinky && !middle && !ring;
  const { pinchRatio } = measureHand(hand);
  const threshold = wasPinching ? config.pinchEndRatio : config.pinchStartRatio;
  // punho e "rock" bloqueiam a pinça, como na versão original
  const pinch = !grab && !rock && pinchRatio < threshold;

  return {
    grab,
    victory: index && middle && !ring && !pinky,
    rock,
    point: index && !middle && !ring && !pinky,
    pinch,
  };
}

// só altera o estado confirmado após n quadros consecutivos discordantes
class PoseDebouncer {
  private confirmed = false;
  private streak = 0;

  constructor(private readonly requiredFrames: number) {}

  get state(): boolean {
    return this.confirmed;
  }

  update(raw: boolean): PosePhase | null {
    if (raw === this.confirmed) {
      this.streak = 0;
      return this.confirmed ? 'move' : null;
    }
    this.streak++;
    if (this.streak < this.requiredFrames) return this.confirmed ? 'move' : null;
    this.confirmed = raw;
    this.streak = 0;
    return raw ? 'start' : 'end';
  }
}

// suaviza os pontos, classifica as poses e emite transições confirmadas (lógica pura)
export class PoseClassifier {
  private readonly smoother: LandmarkSmoother | null;
  private readonly debouncers: Record<PoseName, PoseDebouncer>;
  private readonly handPresence: PoseDebouncer;
  private rawPinch = false;

  constructor(private readonly config: PoseClassifierConfig = DEFAULT_POSE_CLASSIFIER_CONFIG) {
    this.smoother = config.smoothing ? new LandmarkSmoother(config.smoothing) : null;
    this.handPresence = new PoseDebouncer(config.confirmFrames);
    this.debouncers = {
      grab: new PoseDebouncer(config.confirmFrames),
      victory: new PoseDebouncer(config.confirmFrames),
      rock: new PoseDebouncer(config.confirmFrames),
      point: new PoseDebouncer(config.confirmFrames),
      pinch: new PoseDebouncer(config.confirmFrames),
    };
  }

  isActive(pose: PoseName): boolean {
    return this.debouncers[pose].state;
  }

  update(hand: HandLandmarks | null, timestampMs: number): PoseUpdate {
    const landmarks = hand ? this.smooth(hand, timestampMs) : null;
    if (!landmarks) {
      this.smoother?.reset();
      this.rawPinch = false;
    }
    const flags = landmarks ? classifyFrame(landmarks, this.rawPinch, this.config) : NO_POSES;
    this.rawPinch = flags.pinch;

    const presence = this.handPresence.update(landmarks !== null);
    return {
      events: this.collectEvents(flags),
      handLost: presence === 'end',
      landmarks,
      metrics: landmarks ? measureHand(landmarks) : null,
    };
  }

  private smooth(hand: HandLandmarks, timestampMs: number): HandLandmarks {
    return this.smoother ? this.smoother.smooth(hand, timestampMs) : hand;
  }

  private collectEvents(flags: PoseFlags): PoseEvent[] {
    const events: PoseEvent[] = [];
    for (const pose of POSE_NAMES) {
      const phase = this.debouncers[pose].update(flags[pose]);
      if (phase) events.push({ pose, phase });
    }
    return events;
  }
}
