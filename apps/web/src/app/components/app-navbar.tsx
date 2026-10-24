import {
  CubeFocus,
  MoonStars,
  ShieldCheck,
  SignIn,
  SignOut,
  SunDim,
  UserCircle,
} from '@phosphor-icons/react';
import { Link } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { ZoneTheme } from '../../zone/config/constants';
import { getThemePalette } from '../../zone/systems/theme-controller';

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
  const palette = getThemePalette(themeId);

  return (
    <header className="w-full max-w-6xl mb-6 flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2.5 no-underline"
          style={{ color: 'var(--imx-white-warm)' }}
        >
          <span
            className="inline-flex items-center justify-center w-10 h-10 rounded-xl border-2"
            style={{
              background: 'var(--imx-accent-blue)',
              borderColor: 'var(--imx-white-warm)',
              color: '#fffdf7',
            }}
          >
            <CubeFocus size={24} weight="duotone" />
          </span>
          <span className="imx-heading text-xl font-extrabold tracking-tight text-[#fffdf7]">
            {PT_BR.appName}
          </span>
        </Link>
        <span className="imx-badge imx-badge-yellow hidden sm:inline-flex">WebXR • Offline</span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          className="imx-glass-button text-sm py-2 px-3.5"
          onClick={onOpenConsent}
        >
          <ShieldCheck size={19} weight="duotone" />
          <span>{PT_BR.nav.privacyAndConsent}</span>
        </button>

        <button
          type="button"
          className="imx-glass-button text-sm py-2 px-3.5"
          onClick={onToggleTheme}
        >
          {themeId === 'light-glass' ? (
            <SunDim size={19} weight="duotone" />
          ) : (
            <MoonStars size={19} weight="duotone" />
          )}
          <span>{palette.name}</span>
        </button>

        {userEmail ? (
          <div className="flex items-center gap-2">
            <span className="imx-badge imx-badge-blue">
              <UserCircle size={17} weight="duotone" />
              <span className="max-w-[160px] truncate">{userEmail}</span>
            </span>
            <button
              type="button"
              className="imx-glass-button imx-button-danger text-sm py-2 px-3"
              onClick={onSignOut}
            >
              <SignOut size={18} weight="bold" />
              <span>{PT_BR.nav.logout}</span>
            </button>
          </div>
        ) : (
          <Link to="/login" className="imx-glass-button imx-button-primary text-sm py-2 px-3.5">
            <SignIn size={18} weight="bold" />
            <span>{PT_BR.nav.login}</span>
          </Link>
        )}
      </div>
    </header>
  );
}
