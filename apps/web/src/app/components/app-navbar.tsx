import { CubeFocus, Hand, Moon, ShieldCheck, SignIn, SignOut, Sun } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { ZoneTheme } from '../../zone/config/constants';

const HAND_STYLE_KEY = 'imx-hand-style';
export type HandStyleOption = 'classic' | 'stylized';

function readStoredHandStyle(): HandStyleOption {
  try {
    const val = localStorage.getItem(HAND_STYLE_KEY);
    return val === 'classic' ? 'classic' : 'stylized';
  } catch {
    return 'stylized';
  }
}

export interface AppNavbarProps {
  readonly themeId: ZoneTheme;
  readonly onToggleTheme: () => void;
  readonly userEmail: string | null;
  readonly onOpenConsent: () => void;
  readonly onSignOut: () => void;
}

export function AppNavbar({
  themeId,
  onToggleTheme,
  userEmail,
  onOpenConsent,
  onSignOut,
}: AppNavbarProps) {
  const [handStyle, setHandStyle] = useState<HandStyleOption>(readStoredHandStyle);

  const handleToggleHandStyle = () => {
    const next: HandStyleOption = handStyle === 'classic' ? 'stylized' : 'classic';
    setHandStyle(next);
    try {
      localStorage.setItem(HAND_STYLE_KEY, next);
      window.dispatchEvent(new CustomEvent('imx-hand-style-change', { detail: { style: next } }));
    } catch {
      // ignora caso localStorage não esteja disponível
    }
  };

  return (
    <header className="imx-navbar-frame">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2.5 no-underline"
          style={{ color: 'var(--imx-text-title)' }}
        >
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-full border border-[var(--imx-border-solid)]"
            style={{
              background: 'var(--imx-accent-warm)',
              color: '#121316',
            }}
          >
            <CubeFocus size={20} weight="bold" />
          </span>
          <span className="imx-heading text-lg font-extrabold tracking-tight">{PT_BR.appName}</span>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="imx-glass-button text-xs py-2 px-3.5"
          onClick={handleToggleHandStyle}
          title="Alternar estilo do modelo 3D da mão na Zona VR (Clássica / Estilizada)"
        >
          <Hand size={17} weight="regular" />
          <span>Mão: {handStyle === 'classic' ? 'Clássica' : 'Estilizada'}</span>
        </button>

        <button
          type="button"
          className="imx-glass-button text-xs py-2 px-3.5"
          onClick={onOpenConsent}
        >
          <ShieldCheck size={17} weight="regular" />
          <span>{PT_BR.nav.privacyAndConsent}</span>
        </button>

        {/* alternador de tema apenas com ícone phosphor (sem rótulo textual) */}
        <button
          type="button"
          className="imx-glass-button p-2.5"
          onClick={onToggleTheme}
          aria-label={PT_BR.nav.toggleThemeAria}
          title={PT_BR.nav.toggleThemeAria}
        >
          {themeId === 'light-glass' ? (
            <Moon size={18} weight="regular" />
          ) : (
            <Sun size={18} weight="regular" />
          )}
        </button>

        {userEmail ? (
          <div className="flex items-center gap-2">
            <span className="imx-badge imx-badge-darkblue normal-case">
              <span className="max-w-[160px] truncate">{userEmail}</span>
            </span>
            <button
              type="button"
              className="imx-glass-button imx-button-danger text-xs py-2 px-3"
              onClick={onSignOut}
            >
              <SignOut size={16} weight="bold" />
              <span>{PT_BR.nav.logout}</span>
            </button>
          </div>
        ) : (
          <Link to="/login" className="imx-glass-button imx-button-primary text-xs py-2 px-4">
            <SignIn size={16} weight="bold" />
            <span>{PT_BR.nav.login}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
