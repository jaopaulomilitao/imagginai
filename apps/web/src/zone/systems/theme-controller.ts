import { DEFAULT_ZONE_THEME, ZONE_THEMES, type ZoneTheme } from '../config/constants';

export const ZONE_THEME_CHANGE_EVENT = 'imx-theme-change';
export const ZONE_THEME_STORAGE_KEY = 'imagginai.zone.theme';

export interface ThemePalette {
  readonly id: ZoneTheme;
  readonly name: string;
  readonly panelBgColor: string;
  readonly panelBgOpacity: number;
  readonly panelBorderColor: string;
  readonly panelBorderNormalOpacity: number;
  readonly panelBorderActiveOpacity: number;
  readonly panelBorderNormalStroke: number;
  readonly panelBorderActiveStroke: number;
  readonly panelHeaderLineColor: string;
  readonly textTitleColor: string;
  readonly textBodyColor: string;
  readonly textFooterColor: string;
  readonly buttonBgColor: string;
  readonly buttonBgOpacity: number;
  readonly buttonBorderColor: string;
  readonly buttonTextColor: string;
  readonly handleBgColor: string;
  readonly handleBgOpacity: number;
  readonly handleBorderColor: string;
  readonly handleDotsColor: string;
  readonly beltButtonBgColor: string;
  readonly beltButtonBgOpacity: number;
  readonly beltButtonBorderColor: string;
  readonly beltButtonBorderOpacity: number;
  readonly beltIconColor: string;
  readonly beltLabelColor: string;
  readonly statusPillBgColor: string;
  readonly statusPillTextColor: string;
}

export const THEME_PALETTES: Readonly<Record<ZoneTheme, ThemePalette>> = {
  'light-glass': {
    id: 'light-glass',
    name: 'Modo Claro (Vidro)',
    panelBgColor: '#F1F5F9',
    panelBgOpacity: 0.78,
    panelBorderColor: '#FFFFFF',
    panelBorderNormalOpacity: 0.85,
    panelBorderActiveOpacity: 1.0,
    panelBorderNormalStroke: 0.005,
    panelBorderActiveStroke: 0.014,
    panelHeaderLineColor: '#CBD5E1',
    textTitleColor: '#0F172A',
    textBodyColor: '#1E293B',
    textFooterColor: '#475569',
    buttonBgColor: '#F8FAFC',
    buttonBgOpacity: 0.85,
    buttonBorderColor: '#FFFFFF',
    buttonTextColor: '#0F172A',
    handleBgColor: '#E2E8F0',
    handleBgOpacity: 0.85,
    handleBorderColor: '#FFFFFF',
    handleDotsColor: '#0F172A',
    beltButtonBgColor: '#F8FAFC',
    beltButtonBgOpacity: 0.82,
    beltButtonBorderColor: '#FFFFFF',
    beltButtonBorderOpacity: 0.9,
    beltIconColor: '#0F172A',
    beltLabelColor: '#1E293B',
    statusPillBgColor: '#F8FAFC',
    statusPillTextColor: '#0F172A',
  },
  'dark-glass': {
    id: 'dark-glass',
    name: 'Modo Escuro (Obsidiana)',
    panelBgColor: '#0A0F1D',
    panelBgOpacity: 0.84,
    panelBorderColor: '#FFFFFF',
    panelBorderNormalOpacity: 0.65,
    panelBorderActiveOpacity: 1.0,
    panelBorderNormalStroke: 0.005,
    panelBorderActiveStroke: 0.014,
    panelHeaderLineColor: '#1E293B',
    textTitleColor: '#F8FAFC',
    textBodyColor: '#E2E8F0',
    textFooterColor: '#94A3B8',
    buttonBgColor: '#1E293B',
    buttonBgOpacity: 0.88,
    buttonBorderColor: '#FFFFFF',
    buttonTextColor: '#F8FAFC',
    handleBgColor: '#1E293B',
    handleBgOpacity: 0.88,
    handleBorderColor: '#FFFFFF',
    handleDotsColor: '#F8FAFC',
    beltButtonBgColor: '#0F172A',
    beltButtonBgOpacity: 0.88,
    beltButtonBorderColor: '#FFFFFF',
    beltButtonBorderOpacity: 0.7,
    beltIconColor: '#38BDF8',
    beltLabelColor: '#F8FAFC',
    statusPillBgColor: '#0F172A',
    statusPillTextColor: '#38BDF8',
  },
};

// recupera a paleta de cores correspondente ao tema
export function getThemePalette(theme: ZoneTheme): ThemePalette {
  return THEME_PALETTES[theme] ?? THEME_PALETTES['light-glass'];
}

// alterna entre tema claro e escuro
export function toggleTheme(current: ZoneTheme): ZoneTheme {
  return current === 'light-glass' ? 'dark-glass' : 'light-glass';
}

// valida se a string informada é um tema reconhecido
export function isZoneTheme(value: unknown): value is ZoneTheme {
  return typeof value === 'string' && (ZONE_THEMES as readonly string[]).includes(value);
}

// resolve o tema inicial a partir de preferência salva ou padrão
export function resolveInitialTheme(storedPreference?: string | null): ZoneTheme {
  if (isZoneTheme(storedPreference)) {
    return storedPreference;
  }
  return DEFAULT_ZONE_THEME;
}
