// valores normativos da spec; nenhum outro arquivo deve repetir esses números

// limites estruturais do study pack (seção 3.6.2), espelhados em apps/api/app/core/config.py
export const STUDY_PACK_SCHEMA_VERSION = '1.0';
export const CONCEPT_LABEL_MAX_LENGTH = 40;
export const CONCEPT_DEFINITION_MAX_LENGTH = 280;
export const QUIZ_OPTION_COUNT = 4;
export const POSITION_MIN = -1;
export const POSITION_MAX = 1;

// convenções espaciais da zona (seção 3.1)
export const RIG_ORIGIN = { x: 0, y: 1.2, z: 0 } as const;

// calibração unificada do vídeo e das mãos (seção 3.7)
export const DEFAULT_CAMERA_VFOV_DEG = 50;
export const PASSTHROUGH_PLANE_DISTANCE_M = 1.0;

// presets de ambiente (seção 3.3 e fase 3)
export const ENVIRONMENT_PRESETS = ['focus-dark', 'focus-nature'] as const;
export type EnvironmentPreset = (typeof ENVIRONMENT_PRESETS)[number];
export const DEFAULT_ENVIRONMENT_PRESET: EnvironmentPreset = 'focus-dark';

export interface EnvironmentPalette {
  readonly skyColor: string;
  readonly groundColor: string;
  readonly horizonRingColor: string;
  readonly ambientLightColor: string;
  readonly ambientLightIntensity: number;
}

export const ENVIRONMENT_PALETTES: Readonly<Record<EnvironmentPreset, EnvironmentPalette>> = {
  'focus-dark': {
    skyColor: '#0B0F17',
    groundColor: '#121824',
    horizonRingColor: '#1E293B',
    ambientLightColor: '#CBD5E1',
    ambientLightIntensity: 0.85,
  },
  'focus-nature': {
    skyColor: '#0F241D',
    groundColor: '#163026',
    horizonRingColor: '#2D5A47',
    ambientLightColor: '#D1FAE5',
    ambientLightIntensity: 0.9,
  },
};

// modos híbridos e transição suave (seção 3.4 e 3.7)
export const ZONE_MODES = ['focus', 'passthrough'] as const;
export type ZoneMode = (typeof ZONE_MODES)[number];
export const DEFAULT_ZONE_MODE: ZoneMode = 'focus';
export const MODE_TRANSITION_DURATION_MS = 300;
export const MODE_TOGGLE_SHORTCUT_KEY = 'm';

// métricas de desempenho e overlay de depuração (seção 3.8 e fase 3)
export const TARGET_MIN_FPS = 50;
export const DEBUG_QUERY_PARAM = 'debug';
export const ENVIRONMENT_QUERY_PARAM = 'env';
export const DEBUG_HUD_UPDATE_INTERVAL_MS = 250;
export const FPS_SMOOTHING_ALPHA = 0.15;
