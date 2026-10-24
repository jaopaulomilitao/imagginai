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
export const YAW_MIN_DEG = -180;
export const YAW_MAX_DEG = 180;
export const PITCH_MIN_DEG = -80;
export const PITCH_MAX_DEG = 80;
export const ALLOWED_RADII_M = [0.55, 0.75, 1.0, 1.5, 2.0] as const;
export type PanelRadiusM = (typeof ALLOWED_RADII_M)[number];
export const DEFAULT_PANEL_RADIUS_M: PanelRadiusM = 1.5;
export const MIN_TARGET_ANGULAR_SIZE_DEG = 4;

// interação por olhar (dwell) e alça de arraste de 6 pontos (seção 3.2 e 3.6.4)
export const DWELL_DURATION_MS = 800;
export const HANDLE_HOVER_REVEAL_MS = 300;
export const PANEL_SNAP_STEP_DEG = 10;
export const PANEL_MIN_EDGE_GAP_DEG = 5;

// dimensões padrão dos painéis espaciais e limites de escala da alça/botões
export const PANEL_DEFAULT_WIDTH_M = 0.72;
export const PANEL_DEFAULT_HEIGHT_M = 0.52;
export const PANEL_CORNER_RADIUS_M = 0.024;
export const PANEL_HANDLE_WIDTH_M = 0.11;
export const PANEL_HANDLE_HEIGHT_M = 0.075;
export const PANEL_BUTTON_SIZE_M = 0.075;
export const HANDLE_MIN_SCALE = 0.55;
export const HANDLE_MAX_SCALE = 1.15;

// janela de páginas renderizadas do pdf em memória (página atual +- 1, seção 2.2)
export const PDF_PAGE_CACHE_RADIUS = 1;

// calibração unificada do vídeo e das mãos (seção 3.7)
export const DEFAULT_CAMERA_VFOV_DEG = 82;
export const PASSTHROUGH_PLANE_DISTANCE_M = 1.0;
export const DEFAULT_STEREO_EYE_OFFSET_M = 0.028;

// temas visuais da zona (modo claro vidro / modo escuro obsidiana)
export const ZONE_THEMES = ['light-glass', 'dark-glass'] as const;
export type ZoneTheme = (typeof ZONE_THEMES)[number];
export const DEFAULT_ZONE_THEME: ZoneTheme = 'light-glass';

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
    skyColor: '#05070B',
    groundColor: '#090D14',
    horizonRingColor: '#121824',
    ambientLightColor: '#E2E8F0',
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

// belt menu ergonômico, histerese, retenção de olhar e atalhos (seção 3.4 e fase 5)
export const BELT_SHOW_PITCH_THRESHOLD_DEG = -28;
export const BELT_HIDE_PITCH_THRESHOLD_DEG = -14;
export const BELT_SUBMENU_MAX_PITCH_DEG = 22;
export const BELT_SUBMENU_MAX_YAW_DELTA_DEG = 68;
export const BELT_SHOW_DWELL_MS = 350;
export const BELT_FADE_DURATION_MS = 220;
export const BELT_YAW_LERP_ALPHA = 0.1;
export const BELT_CENTER_PITCH_DEG = -32;
export const BELT_ARC_MAX_HALF_WIDTH_DEG = 56;
export const BELT_MAX_ITEMS = 7;
export const BELT_RADIUS_M = 1.15;
export const BELT_ITEM_WIDTH_M = 0.138;
export const BELT_ITEM_HEIGHT_M = 0.118;
export const BELT_PRIMARY_ITEM_WIDTH_M = 0.195;
export const BELT_PRIMARY_ITEM_HEIGHT_M = 0.148;
export const BELT_EXIT_CONFIRM_TIMEOUT_MS = 3000;

export const BELT_SHORTCUT_EXIT_KEY = 'escape';
export const BELT_SHORTCUT_ZONES_KEY = 'z';
export const BELT_SHORTCUT_CONTENTS_KEY = 'b';
export const BELT_SHORTCUT_MODE_KEY = 'm';
export const BELT_SHORTCUT_THEME_KEY = 't';
export const BELT_SHORTCUT_POMODORO_KEY = 'p';
export const BELT_SHORTCUT_RECENTER_KEY = 'c';

// temporizador pomodoro (seção 3.5 e fase 5)
export const POMODORO_PRESETS = ['25/5', '20/5'] as const;
export type PomodoroPreset = (typeof POMODORO_PRESETS)[number];
export const DEFAULT_POMODORO_PRESET: PomodoroPreset = '25/5';
export const POMODORO_FOCUS_25_MS = 25 * 60 * 1000;
export const POMODORO_FOCUS_20_MS = 20 * 60 * 1000;
export const POMODORO_BREAK_5_MS = 5 * 60 * 1000;
export const POMODORO_WARNING_BEFORE_END_MS = 60 * 1000;

// métricas de desempenho e overlay de depuração (seção 3.8 e fase 3)
export const TARGET_MIN_FPS = 50;
export const DEBUG_QUERY_PARAM = 'debug';
export const ENVIRONMENT_QUERY_PARAM = 'env';
export const ZONE_ID_QUERY_PARAM = 'zoneId';
export const DEFAULT_DEMO_ZONE_ID = 'zone-demo';
export const DEBUG_HUD_UPDATE_INTERVAL_MS = 250;
export const FPS_SMOOTHING_ALPHA = 0.15;
