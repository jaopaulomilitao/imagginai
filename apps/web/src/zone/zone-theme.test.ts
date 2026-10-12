import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ZONE_THEME,
  ENVIRONMENT_PALETTES,
  PANEL_CORNER_RADIUS_M,
  ZONE_THEMES,
} from './config/constants';
import { computeRoundedRectBounds } from './systems/rounded-shape';
import {
  getThemePalette,
  isZoneTheme,
  resolveInitialTheme,
  toggleTheme,
} from './systems/theme-controller';

describe('Zone Aesthetics — Rounded Rect Bounds & Math', () => {
  it('defines valid zone theme constants', () => {
    expect(ZONE_THEMES).toContain('light-glass');
    expect(ZONE_THEMES).toContain('dark-glass');
  });
  it('computes correct symmetric bounds and preserves radius within limits', () => {
    const bounds = computeRoundedRectBounds(0.72, 0.52, PANEL_CORNER_RADIUS_M);
    expect(bounds.minX).toBeCloseTo(-0.36, 5);
    expect(bounds.maxX).toBeCloseTo(0.36, 5);
    expect(bounds.minY).toBeCloseTo(-0.26, 5);
    expect(bounds.maxY).toBeCloseTo(0.26, 5);
    expect(bounds.clampedRadius).toBe(PANEL_CORNER_RADIUS_M);
  });

  it('clamps corner radius to at most half-width or half-height for small buttons', () => {
    const smallBtn = computeRoundedRectBounds(0.06, 0.04, 0.05);
    // meio da altura é 0.02, que deve ser o limite superior
    expect(smallBtn.clampedRadius).toBe(0.02);
  });
});

describe('Zone Aesthetics — Theme Controller & Palettes', () => {
  it('toggles between light-glass and dark-glass themes', () => {
    expect(toggleTheme('light-glass')).toBe('dark-glass');
    expect(toggleTheme('dark-glass')).toBe('light-glass');
  });

  it('validates theme strings and falls back to light-glass on unknown input', () => {
    expect(isZoneTheme('light-glass')).toBe(true);
    expect(isZoneTheme('dark-glass')).toBe(true);
    expect(isZoneTheme('neon-cyber')).toBe(false);

    expect(resolveInitialTheme('dark-glass')).toBe('dark-glass');
    expect(resolveInitialTheme('unknown')).toBe(DEFAULT_ZONE_THEME);
    expect(resolveInitialTheme(null)).toBe(DEFAULT_ZONE_THEME);
  });

  it('provides light-glass palette with translucent light background, pure white border and dark text', () => {
    const light = getThemePalette('light-glass');
    expect(light.panelBgColor).toBe('#F1F5F9');
    expect(light.panelBgOpacity).toBeLessThan(1.0);
    expect(light.panelBorderColor).toBe('#FFFFFF');
    expect(light.textTitleColor).toBe('#0F172A');
    expect(light.textBodyColor).toBe('#1E293B');
    expect(light.panelBorderActiveStroke).toBeGreaterThan(light.panelBorderNormalStroke);
  });

  it('provides dark-glass palette with translucent dark background, pure white border and light text', () => {
    const dark = getThemePalette('dark-glass');
    expect(dark.panelBgColor).toBe('#0A0F1D');
    expect(dark.panelBgOpacity).toBeLessThan(1.0);
    expect(dark.panelBorderColor).toBe('#FFFFFF');
    expect(dark.textTitleColor).toBe('#F8FAFC');
    expect(dark.textBodyColor).toBe('#E2E8F0');
    expect(dark.panelBorderActiveStroke).toBe(0.014);
    expect(dark.panelBorderNormalStroke).toBe(0.005);
  });

  it('configures focus-dark environment with low-stimulus blue-black and charcoal colors', () => {
    const focusDark = ENVIRONMENT_PALETTES['focus-dark'];
    expect(focusDark.skyColor).toBe('#05070B');
    expect(focusDark.groundColor).toBe('#090D14');
    expect(focusDark.horizonRingColor).toBe('#121824');
  });
});
