import { useState } from 'react';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { ZoneTheme } from '../../zone/config/constants';
import { getThemePalette, toggleTheme } from '../../zone/systems/theme-controller';

export function HomePage() {
  const [themeId, setThemeId] = useState<ZoneTheme>('light-glass');
  const palette = getThemePalette(themeId);

  const handleToggleTheme = () => {
    // alterna entre vidro claro e vidro escuro mantendo paridade estética com a zona xr
    setThemeId((prev) => toggleTheme(prev));
  };

  return (
    <main className="imx-shell" data-imx-theme={themeId}>
      <section className="imx-glass-panel">
        <div className="imx-panel-header">
          <span className="imx-badge">{PT_BR.appName}</span>
          <button type="button" className="imx-glass-button" onClick={handleToggleTheme}>
            <span>🌓</span>
            <span>{palette.name}</span>
          </button>
        </div>
        <h1 className="imx-title">{PT_BR.home.title}</h1>
        <p className="imx-subtitle">{PT_BR.home.subtitle}</p>
        <div className="imx-actions">
          <a className="imx-glass-button" href="/zone.html">
            {PT_BR.home.openDemoZone}
          </a>
        </div>
      </section>
    </main>
  );
}
