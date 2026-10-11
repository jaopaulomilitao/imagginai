import type { Landmark } from '../core/landmarks';

// gerador de mãos sintéticas para testes e para as sessões gravadas em fixtures/landmark-sessions

export interface FingerState {
  index: boolean;
  middle: boolean;
  ring: boolean;
  pinky: boolean;
}

export interface SyntheticHandOptions {
  fingers: FingerState;
  // distância polegar–indicador dividida pelo tamanho da mão (punho → ponto 9)
  pinchRatio: number;
  // deslocamento da mão inteira na imagem
  offsetX: number;
  offsetY: number;
  // fator de escala (mão mais próxima ou mais distante da câmera)
  scale: number;
}

export const OPEN_HAND: FingerState = { index: true, middle: true, ring: true, pinky: true };
export const FIST: FingerState = { index: false, middle: false, ring: false, pinky: false };
export const VICTORY: FingerState = { index: true, middle: true, ring: false, pinky: false };
export const POINTING: FingerState = { index: true, middle: false, ring: false, pinky: false };
export const ROCK: FingerState = { index: true, middle: false, ring: false, pinky: true };

const DEFAULT_OPTIONS: SyntheticHandOptions = {
  fingers: OPEN_HAND,
  pinchRatio: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

// coordenadas base com o punho embaixo e os dedos apontando para cima (y cresce para baixo)
const WRIST = { x: 0.5, y: 0.8 };
const MCP_Y = 0.65;
const FINGER_X = { index: 0.45, middle: 0.5, ring: 0.55, pinky: 0.6 } as const;
const FINGER_SEGMENTS = [0.05, 0.03, 0.03] as const;

type FingerName = keyof FingerState;

function fingerChain(name: FingerName, extended: boolean): Landmark[] {
  const x = FINGER_X[name];
  const mcp = { x, y: MCP_Y, z: 0 };
  const pip = { x, y: MCP_Y - FINGER_SEGMENTS[0], z: 0 };
  if (extended) {
    const dip = { x, y: pip.y - FINGER_SEGMENTS[1], z: 0 };
    return [mcp, pip, dip, { x, y: dip.y - FINGER_SEGMENTS[2], z: 0 }];
  }
  // dedo dobrado: a ponta volta para perto da palma, mais próxima do punho que a articulação pip
  return [mcp, pip, { x, y: MCP_Y - 0.02, z: -0.02 }, { x, y: MCP_Y + 0.01, z: -0.02 }];
}

function thumbChain(indexTip: Landmark, pinchRatio: number, handSize: number): Landmark[] {
  const tip = { x: indexTip.x - pinchRatio * handSize, y: indexTip.y, z: indexTip.z };
  return [
    { x: 0.42, y: 0.75, z: 0 },
    { x: 0.39, y: 0.7, z: 0 },
    { x: (0.39 + tip.x) / 2, y: (0.7 + tip.y) / 2, z: 0 },
    tip,
  ];
}

function transform(point: Landmark, options: SyntheticHandOptions): Landmark {
  return {
    x: WRIST.x + (point.x - WRIST.x) * options.scale + options.offsetX,
    y: WRIST.y + (point.y - WRIST.y) * options.scale + options.offsetY,
    z: point.z * options.scale,
  };
}

export function syntheticHand(overrides: Partial<SyntheticHandOptions> = {}): Landmark[] {
  const options = { ...DEFAULT_OPTIONS, ...overrides };
  const handSize = WRIST.y - MCP_Y;
  const index = fingerChain('index', options.fingers.index);
  const indexTip = index[3] ?? { x: 0, y: 0, z: 0 };
  const points: Landmark[] = [
    { x: WRIST.x, y: WRIST.y, z: 0 },
    ...thumbChain(indexTip, options.pinchRatio, handSize),
    ...index,
    ...fingerChain('middle', options.fingers.middle),
    ...fingerChain('ring', options.fingers.ring),
    ...fingerChain('pinky', options.fingers.pinky),
  ];
  return points.map((point) => transform(point, options));
}
