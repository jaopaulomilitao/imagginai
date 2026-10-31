import {
  CaretDown,
  ChartBar,
  Gear,
  Hand,
  List,
  Moon,
  ShieldCheck,
  SignIn,
  SignOut,
  Sun,
  X,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

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
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const preferencesRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // fecha menu suspenso de preferências ao clicar fora ou pressionar escape
  useEffect(() => {
    if (!isPreferencesOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (preferencesRef.current && !preferencesRef.current.contains(event.target as Node)) {
        setIsPreferencesOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsPreferencesOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPreferencesOpen]);

  const handleSelectHandStyle = (style: HandStyleOption) => {
    setHandStyle(style);
    try {
      localStorage.setItem(HAND_STYLE_KEY, style);
      window.dispatchEvent(new CustomEvent('imx-hand-style-change', { detail: { style } }));
    } catch {
      // ignora caso localStorage não esteja disponível
    }
  };

  return (
    <header className="imx-navbar-frame">
      <div className="flex items-center justify-between w-full">
        {/* Identidade visual com logo oficial do projeto */}
        <Link
          to="/"
          onClick={() => {
            setIsPreferencesOpen(false);
            setIsMobileMenuOpen(false);
          }}
          className="inline-flex items-center gap-2.5 sm:gap-3 no-underline group select-none"
          style={{ color: 'var(--imx-text-title)' }}
        >
          <img
            src="/ui/simbolo-imagginai.svg"
            alt="IMAGGINAI"
            className="h-6 sm:h-7 w-auto object-contain transition-transform group-hover:scale-105"
          />
          <div className="flex flex-col leading-none">
            <span className="imx-heading text-base sm:text-lg font-black tracking-tight">
              {PT_BR.appName}
            </span>
            <span
              className="text-[9px] uppercase tracking-widest font-mono hidden sm:block opacity-65 mt-0.5"
              style={{ color: 'var(--imx-text-muted)' }}
            >
              navigable augmented intelligence
            </span>
          </div>
        </Link>

        {/* Navegação principal em linha única no Desktop */}
        <div className="hidden md:flex items-center gap-2">
          <Link
            to="/dashboard"
            onClick={() => setIsPreferencesOpen(false)}
            className={`imx-glass-button text-xs py-1.5 px-3 flex items-center gap-1.5 ${
              location.pathname === '/dashboard'
                ? 'border-[var(--imx-accent-darkblue)] bg-[var(--imx-accent-darkblue-soft)]'
                : ''
            }`}
            title={PT_BR.nav.dashboard}
          >
            <ChartBar size={16} weight="bold" />
            <span>{PT_BR.nav.dashboard}</span>
          </Link>

          {/* Menu suspenso de preferências organizado */}
          <div className="relative" ref={preferencesRef}>
            <button
              type="button"
              onClick={() => setIsPreferencesOpen((prev) => !prev)}
              className={`imx-glass-button text-xs py-1.5 px-3 flex items-center gap-1.5 transition-colors ${
                isPreferencesOpen
                  ? 'border-[var(--imx-border-strong)] bg-[var(--imx-bg-card-alt)]'
                  : ''
              }`}
              aria-expanded={isPreferencesOpen}
              aria-haspopup="true"
              title={PT_BR.nav.preferences}
            >
              <Gear size={16} weight="bold" />
              <span>{PT_BR.nav.preferences}</span>
              <CaretDown
                size={12}
                weight="bold"
                className={`transition-transform duration-200 ${isPreferencesOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {isPreferencesOpen && (
              <div
                className="absolute right-0 top-full mt-2 w-72 p-3 rounded-xl shadow-2xl z-50 border border-[var(--imx-border-solid)] bg-[var(--imx-bg-surface)] backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-150"
                role="menu"
              >
                <div className="flex items-center justify-between px-1 pb-2 border-b border-[var(--imx-border-subtle)] mb-2.5">
                  <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-[var(--imx-text-muted)]">
                    {PT_BR.nav.preferences}
                  </span>
                </div>

                {/* Opção: Estilo do Modelo 3D da Mão na Zona */}
                <div className="p-2.5 rounded-lg bg-[var(--imx-bg-card)] border border-[var(--imx-border-subtle)] mb-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <div
                      className="flex items-center gap-1.5 text-xs font-semibold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      <Hand size={15} weight="bold" />
                      <span>{PT_BR.nav.handModel}</span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[var(--imx-border-subtle)] bg-[var(--imx-bg-elevated)] text-[var(--imx-text-muted)]">
                      Zona VR
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--imx-text-muted)] m-0 mb-2 leading-snug">
                    Estilo visual do rastreamento de mãos no headset VR Box.
                  </p>
                  <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-[var(--imx-bg-elevated)] rounded-lg border border-[var(--imx-border-subtle)]">
                    <button
                      type="button"
                      onClick={() => handleSelectHandStyle('stylized')}
                      className={`text-xs py-1 px-2 rounded-md font-mono font-medium transition-all ${
                        handStyle === 'stylized'
                          ? 'bg-[var(--imx-accent-darkblue)] text-white shadow-sm font-bold'
                          : 'text-[var(--imx-text-body)] hover:bg-[var(--imx-bg-card)]'
                      }`}
                    >
                      Estilizada
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectHandStyle('classic')}
                      className={`text-xs py-1 px-2 rounded-md font-mono font-medium transition-all ${
                        handStyle === 'classic'
                          ? 'bg-[var(--imx-accent-darkblue)] text-white shadow-sm font-bold'
                          : 'text-[var(--imx-text-body)] hover:bg-[var(--imx-bg-card)]'
                      }`}
                    >
                      Clássica
                    </button>
                  </div>
                </div>

                {/* Opção: Privacidade & LGPD */}
                <button
                  type="button"
                  onClick={() => {
                    setIsPreferencesOpen(false);
                    onOpenConsent();
                  }}
                  className="w-full p-2.5 rounded-lg bg-[var(--imx-bg-card)] hover:bg-[var(--imx-bg-card-alt)] border border-[var(--imx-border-subtle)] hover:border-[var(--imx-border-strong)] transition-all flex items-center justify-between text-left group"
                >
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded bg-[var(--imx-bg-elevated)] text-[var(--imx-accent-darkblue)]">
                      <ShieldCheck size={16} weight="bold" />
                    </div>
                    <div>
                      <div
                        className="text-xs font-semibold"
                        style={{ color: 'var(--imx-text-title)' }}
                      >
                        {PT_BR.nav.privacyAndConsent}
                      </div>
                      <div className="text-[10px] text-[var(--imx-text-muted)]">
                        Consentimento e telemetria local
                      </div>
                    </div>
                  </div>
                  <span className="text-xs text-[var(--imx-text-muted)] group-hover:translate-x-0.5 transition-transform">
                    &rarr;
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Alternador de tema */}
          <button
            type="button"
            className="imx-glass-button p-2"
            onClick={onToggleTheme}
            aria-label={PT_BR.nav.toggleThemeAria}
            title={PT_BR.nav.toggleThemeAria}
          >
            {themeId === 'light-glass' ? (
              <Moon size={17} weight="regular" />
            ) : (
              <Sun size={17} weight="regular" />
            )}
          </button>

          {/* Estado de autenticação */}
          {userEmail ? (
            <div className="flex items-center gap-1.5 pl-2 border-l border-[var(--imx-border-subtle)]">
              <span
                className="imx-badge imx-badge-darkblue normal-case py-1 px-2.5 max-w-[130px] lg:max-w-[170px] truncate"
                title={userEmail}
              >
                {userEmail}
              </span>
              <button
                type="button"
                className="imx-glass-button imx-button-danger text-xs py-1.5 px-2.5"
                onClick={onSignOut}
                title={PT_BR.nav.logout}
              >
                <SignOut size={16} weight="bold" />
                <span>{PT_BR.nav.logout}</span>
              </button>
            </div>
          ) : (
            <Link to="/login" className="imx-glass-button imx-button-primary text-xs py-1.5 px-3.5">
              <SignIn size={16} weight="bold" />
              <span>{PT_BR.nav.login}</span>
            </Link>
          )}
        </div>

        {/* Controles do topo no Mobile (tema + menu hambúrguer) */}
        <div className="flex md:hidden items-center gap-1.5">
          <button
            type="button"
            className="imx-glass-button p-2"
            onClick={onToggleTheme}
            aria-label={PT_BR.nav.toggleThemeAria}
            title={PT_BR.nav.toggleThemeAria}
          >
            {themeId === 'light-glass' ? (
              <Moon size={17} weight="regular" />
            ) : (
              <Sun size={17} weight="regular" />
            )}
          </button>

          <button
            type="button"
            className="imx-glass-button p-2"
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
            aria-expanded={isMobileMenuOpen}
            aria-label="Abrir menu de navegação"
          >
            {isMobileMenuOpen ? <X size={18} weight="bold" /> : <List size={18} weight="bold" />}
          </button>
        </div>
      </div>

      {/* Gaveta responsiva expansível no Mobile */}
      {isMobileMenuOpen && (
        <div className="md:hidden w-full border-t border-[var(--imx-border-subtle)] pt-3 mt-3 flex flex-col gap-2 animate-in fade-in slide-in-from-top-2 duration-150">
          <Link
            to="/"
            onClick={() => setIsMobileMenuOpen(false)}
            className={`imx-glass-button justify-start text-xs py-2 px-3 w-full ${
              location.pathname === '/'
                ? 'border-[var(--imx-accent-darkblue)] bg-[var(--imx-accent-darkblue-soft)]'
                : ''
            }`}
          >
            <span>{PT_BR.nav.zones}</span>
          </Link>

          <Link
            to="/dashboard"
            onClick={() => setIsMobileMenuOpen(false)}
            className={`imx-glass-button justify-start text-xs py-2 px-3 w-full ${
              location.pathname === '/dashboard'
                ? 'border-[var(--imx-accent-darkblue)] bg-[var(--imx-accent-darkblue-soft)]'
                : ''
            }`}
          >
            <ChartBar size={16} weight="bold" />
            <span>{PT_BR.nav.dashboard}</span>
          </Link>

          {/* Preferências no Mobile */}
          <div className="p-2.5 rounded-xl bg-[var(--imx-bg-card)] border border-[var(--imx-border-subtle)] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span
                className="text-xs font-semibold flex items-center gap-1.5"
                style={{ color: 'var(--imx-text-title)' }}
              >
                <Hand size={15} weight="bold" />
                <span>{PT_BR.nav.handModel}</span>
              </span>
              <span className="text-[10px] font-mono text-[var(--imx-text-muted)]">
                {handStyle === 'stylized' ? 'Estilizada' : 'Clássica'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5 p-0.5 bg-[var(--imx-bg-elevated)] rounded-lg border border-[var(--imx-border-subtle)]">
              <button
                type="button"
                onClick={() => handleSelectHandStyle('stylized')}
                className={`text-xs py-1.5 px-2 rounded-md font-mono font-medium ${
                  handStyle === 'stylized'
                    ? 'bg-[var(--imx-accent-darkblue)] text-white font-bold'
                    : 'text-[var(--imx-text-body)]'
                }`}
              >
                Estilizada
              </button>
              <button
                type="button"
                onClick={() => handleSelectHandStyle('classic')}
                className={`text-xs py-1.5 px-2 rounded-md font-mono font-medium ${
                  handStyle === 'classic'
                    ? 'bg-[var(--imx-accent-darkblue)] text-white font-bold'
                    : 'text-[var(--imx-text-body)]'
                }`}
              >
                Clássica
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setIsMobileMenuOpen(false);
              onOpenConsent();
            }}
            className="imx-glass-button justify-start text-xs py-2 px-3 w-full"
          >
            <ShieldCheck size={16} weight="bold" />
            <span>{PT_BR.nav.privacyAndConsent}</span>
          </button>

          {/* Autenticação no Mobile */}
          {userEmail ? (
            <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-[var(--imx-bg-card)] border border-[var(--imx-border-subtle)] mt-1">
              <span className="text-xs truncate max-w-[190px] font-mono text-[var(--imx-text-title)]">
                {userEmail}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  onSignOut();
                }}
                className="imx-glass-button imx-button-danger text-xs py-1.5 px-2.5"
              >
                <SignOut size={15} weight="bold" />
                <span>{PT_BR.nav.logout}</span>
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              onClick={() => setIsMobileMenuOpen(false)}
              className="imx-glass-button imx-button-primary justify-center text-xs py-2 px-3 w-full mt-1"
            >
              <SignIn size={16} weight="bold" />
              <span>{PT_BR.nav.login}</span>
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
