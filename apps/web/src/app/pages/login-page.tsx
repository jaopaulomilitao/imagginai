import {
  ArrowLeft,
  CheckCircle,
  EnvelopeSimple,
  Key,
  SignIn,
  UserPlus,
  UserSwitch,
  WarningCircle,
} from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { ZoneTheme } from '../../zone/config/constants';
import { signInAnonymously, signInWithEmail, signUpWithEmail } from '../services/supabase-client';

export interface LoginPageProps {
  readonly themeId: ZoneTheme;
  readonly onAuthSuccess: (email: string) => void;
}

export function LoginPage({ themeId, onAuthSuccess }: LoginPageProps) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const session = await signInWithEmail(email.trim(), password);
        onAuthSuccess(session.user.email ?? email.trim());
        await navigate('/');
      } else {
        const session = await signUpWithEmail(email.trim(), password);
        if (session) {
          onAuthSuccess(session.user.email ?? email.trim());
          await navigate('/');
        } else {
          setInfoMsg(PT_BR.auth.signUpSuccess);
          setMode('signin');
        }
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleAnonymous = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    setLoading(true);
    try {
      const session = await signInAnonymously();
      onAuthSuccess(session.user.email ?? 'Anônimo (Supabase)');
      await navigate('/');
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="imx-shell justify-center" data-imx-theme={themeId}>
      <section className="imx-glass-panel max-w-xl">
        <div className="imx-panel-header">
          <Link to="/" className="imx-glass-button text-sm py-2 px-3">
            <ArrowLeft size={18} weight="bold" />
            <span>{PT_BR.auth.backToZones}</span>
          </Link>
          <span className="imx-badge imx-badge-blue">Supabase Auth</span>
        </div>

        <h1 className="imx-title">{PT_BR.auth.title}</h1>
        <p className="imx-subtitle text-sm">{PT_BR.auth.subtitle}</p>

        {errorMsg && (
          <div className="imx-glass-card mb-4 border-2 border-[var(--imx-accent-red)] flex items-start gap-2.5">
            <WarningCircle
              size={22}
              weight="duotone"
              style={{ color: 'var(--imx-accent-red)', flexShrink: 0 }}
            />
            <span className="text-sm font-medium" style={{ color: 'var(--imx-accent-red)' }}>
              {errorMsg}
            </span>
          </div>
        )}

        {infoMsg && (
          <div className="imx-glass-card mb-4 border-2 border-[var(--imx-accent-blue)] flex items-start gap-2.5">
            <CheckCircle
              size={22}
              weight="duotone"
              style={{ color: 'var(--imx-accent-blue)', flexShrink: 0 }}
            />
            <span className="text-sm font-medium">{infoMsg}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4 mb-5">
          <div>
            <label className="block text-sm font-semibold mb-1.5" htmlFor="imx-login-email">
              <span className="inline-flex items-center gap-1.5">
                <EnvelopeSimple size={17} weight="duotone" />
                <span>{PT_BR.auth.emailLabel}</span>
              </span>
            </label>
            <input
              id="imx-login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={PT_BR.auth.emailPlaceholder}
              className="imx-input"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-1.5" htmlFor="imx-login-password">
              <span className="inline-flex items-center gap-1.5">
                <Key size={17} weight="duotone" />
                <span>{PT_BR.auth.passwordLabel}</span>
              </span>
            </label>
            <input
              id="imx-login-password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={PT_BR.auth.passwordPlaceholder}
              className="imx-input"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="imx-glass-button imx-button-primary flex-1"
            >
              {mode === 'signin' ? (
                <>
                  <SignIn size={20} weight="bold" />
                  <span>{PT_BR.auth.signInButton}</span>
                </>
              ) : (
                <>
                  <UserPlus size={20} weight="bold" />
                  <span>{PT_BR.auth.signUpButton}</span>
                </>
              )}
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
              className="imx-glass-button text-sm"
            >
              {mode === 'signin' ? PT_BR.auth.switchToSignUp : PT_BR.auth.switchToSignIn}
            </button>
          </div>
        </form>

        <div className="pt-4 border-t border-[var(--imx-glass-border-subtle)] flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleAnonymous()}
            className="imx-glass-button text-sm"
          >
            <UserSwitch size={18} weight="duotone" />
            <span>{PT_BR.auth.anonymousButton}</span>
          </button>

          <Link to="/" className="imx-glass-button imx-button-accent text-sm">
            <span>{PT_BR.auth.continueLocalButton}</span>
          </Link>
        </div>
      </section>
    </main>
  );
}
