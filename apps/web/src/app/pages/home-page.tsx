import { ArrowUpRight, ClockCounterClockwise, Goggles, Plus, Trash } from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';
import { zoneStorage, type StoredZoneSessionState } from '../../shared/storage/dexie-db';
import type { Zone } from '../../shared/types/zone';
import type { ZoneTheme } from '../../zone/config/constants';
import { AppNavbar } from '../components/app-navbar';
import { createZoneRemote, deleteZoneRemote, fetchZonesRemote } from '../services/api-client';
import { selectResumeZone } from '../services/pack-customizer';

const DEMO_ZONE_IDS = new Set([
  'demo',
  'zone-demo-engenharia-circuitos-cc',
  'zone-demo-saude-anatomia-humana',
]);

export interface HomePageProps {
  readonly themeId: ZoneTheme;
  readonly onToggleTheme: () => void;
  readonly userEmail: string | null;
  readonly onOpenConsent: () => void;
  readonly onSignOut: () => void;
  readonly onRequestEnterZone: (zone: Zone) => void;
}

export function HomePage({
  themeId,
  onToggleTheme,
  userEmail,
  onOpenConsent,
  onSignOut,
  onRequestEnterZone,
}: HomePageProps) {
  const navigate = useNavigate();
  const [zones, setZones] = useState<Zone[]>([]);
  const [latestSession, setLatestSession] = useState<StoredZoneSessionState | null>(null);
  const [newZoneName, setNewZoneName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;
    const loadZonesAndSession = async () => {
      const localZones = await zoneStorage.listZones();
      const session = await zoneStorage.loadLatestSessionState();
      if (!active) return;
      setZones(localZones);
      setLatestSession(session);

      if (userEmail) {
        try {
          const remoteZones = await fetchZonesRemote();
          for (const rz of remoteZones) {
            await zoneStorage.saveZone(rz);
          }
          const merged = await zoneStorage.listZones();
          if (active) setZones(merged);
        } catch {
          // preserva a listagem local quando o servidor está inacessível
        }
      }
    };
    void loadZonesAndSession();
    return () => {
      active = false;
    };
  }, [userEmail]);

  const handleCreateZone = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = newZoneName.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const now = new Date().toISOString();
      let created: Zone = {
        id: crypto.randomUUID(),
        name: trimmed,
        environment: 'focus-dark',
        sourceIds: [],
        packId: null,
        layout: [],
        createdAt: now,
        updatedAt: now,
      };
      if (userEmail) {
        try {
          created = await createZoneRemote({ name: trimmed, environment: 'focus-dark' });
        } catch {
          // mantém criação local caso a api não esteja acessível
        }
      }
      await zoneStorage.saveZone(created);
      setNewZoneName('');
      await navigate(`/zones/${encodeURIComponent(created.id)}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteZone = async (zoneId: string) => {
    await zoneStorage.deleteZone(zoneId);
    if (userEmail && !DEMO_ZONE_IDS.has(zoneId)) {
      try {
        await deleteZoneRemote(zoneId);
      } catch {
        // ignora falha remota mantendo exclusão local
      }
    }
    setZones(await zoneStorage.listZones());
  };

  const resumeMatch = selectResumeZone(zones, latestSession);

  return (
    <main className="imx-shell" data-imx-theme={themeId}>
      <AppNavbar
        themeId={themeId}
        onToggleTheme={onToggleTheme}
        userEmail={userEmail}
        onOpenConsent={onOpenConsent}
        onSignOut={onSignOut}
      />

      <section className="imx-glass-panel flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[var(--imx-border-solid)]">
          <div>
            <span className="imx-badge imx-badge-warm mb-2">Estudo Espacial</span>
            <h1 className="imx-title">{PT_BR.home.title}</h1>
            <p className="imx-subtitle m-0 max-w-2xl">{PT_BR.home.subtitle}</p>
          </div>
          <div className="imx-display-font text-right hidden sm:block">
            <div className="text-3xl font-bold" style={{ color: 'var(--imx-text-title)' }}>
              {String(zones.length).padStart(2, '0')}
            </div>
            <div
              className="text-xs uppercase tracking-wider"
              style={{ color: 'var(--imx-text-muted)' }}
            >
              Zonas ativas
            </div>
          </div>
        </div>

        {/* banner: retomar de onde parou */}
        {resumeMatch && (
          <div
            className="imx-glass-card flex flex-wrap items-center justify-between gap-4"
            style={{ borderLeft: '4px solid var(--imx-accent-warm)' }}
          >
            <div className="flex items-start gap-3.5">
              <span
                className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-[var(--imx-border-solid)] shrink-0"
                style={{ background: 'var(--imx-accent-warm)', color: '#121316' }}
              >
                <ClockCounterClockwise size={20} weight="bold" />
              </span>
              <div>
                <span className="imx-badge imx-badge-warm mb-1">
                  {PT_BR.home.resumeBanner.badge}
                </span>
                <h2
                  className="imx-heading text-lg font-extrabold m-0"
                  style={{ color: 'var(--imx-text-title)' }}
                >
                  {PT_BR.home.resumeBanner.title(resumeMatch.zone.name)}
                </h2>
                <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--imx-text-muted)' }}>
                  {PT_BR.home.resumeBanner.details(
                    resumeMatch.session.completedPomodoroBlocks,
                    new Date(resumeMatch.session.exitedAt).toLocaleString('pt-BR'),
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                to={`/zones/${encodeURIComponent(resumeMatch.zone.id)}`}
                className="imx-glass-button text-xs"
              >
                <span>{PT_BR.home.resumeBanner.reviewButton}</span>
              </Link>
              <button
                type="button"
                onClick={() => onRequestEnterZone(resumeMatch.zone)}
                className="imx-glass-button imx-button-accent text-xs"
              >
                <Goggles size={18} weight="bold" />
                <span>{PT_BR.home.resumeBanner.resumeButton}</span>
              </button>
            </div>
          </div>
        )}

        {/* formulário de criação de nova zona */}
        <form
          onSubmit={(e) => void handleCreateZone(e)}
          className="imx-glass-card grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end"
        >
          <div className="md:col-span-9">
            <label
              htmlFor="imx-new-zone-name"
              className="block text-xs font-bold uppercase tracking-wider mb-1.5 imx-display-font"
            >
              {PT_BR.home.zoneNameLabel}
            </label>
            <input
              id="imx-new-zone-name"
              type="text"
              required
              maxLength={80}
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
              placeholder={PT_BR.home.zoneNamePlaceholder}
              className="imx-input"
            />
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={creating}
              className="imx-glass-button imx-button-primary w-full"
            >
              <Plus size={18} weight="bold" />
              <span>{creating ? PT_BR.home.creatingButton : PT_BR.home.createButton}</span>
            </button>
          </div>
        </form>

        {/* grade bento de zonas com bordas sólidas de 1px */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {zones.map((zone, idx) => {
            const isDemo = DEMO_ZONE_IDS.has(zone.id);
            const hasPack = zone.packId !== null;

            return (
              <article key={zone.id} className="imx-glass-card flex flex-col justify-between gap-5">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-[var(--imx-border-subtle)]">
                    <span className="imx-display-font text-xs font-bold tracking-wider">
                      [{String(idx + 1).padStart(2, '0')}]
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isDemo ? (
                        <span className="imx-badge imx-badge-warm">{PT_BR.home.demoBadge}</span>
                      ) : (
                        <span className="imx-badge">{PT_BR.home.localBadge}</span>
                      )}
                    </div>
                  </div>

                  <h3
                    className="imx-heading text-lg font-extrabold m-0 mb-3"
                    style={{ color: 'var(--imx-text-title)' }}
                  >
                    {zone.name}
                  </h3>

                  <div className="flex items-center gap-1.5 text-xs">
                    {hasPack ? (
                      <span className="imx-badge imx-badge-darkblue">
                        {PT_BR.home.statusReadyOffline}
                      </span>
                    ) : (
                      <span className="imx-badge imx-badge-warm">
                        {PT_BR.home.statusAwaitingPdf}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--imx-border-solid)]">
                  {hasPack && (
                    <button
                      type="button"
                      onClick={() => onRequestEnterZone(zone)}
                      className="imx-glass-button imx-button-primary flex-1 text-xs py-2 px-3"
                    >
                      <Goggles size={17} weight="bold" />
                      <span>{PT_BR.home.openDemoZone}</span>
                    </button>
                  )}

                  <Link
                    to={`/zones/${encodeURIComponent(zone.id)}`}
                    className={`imx-glass-button text-xs py-2 px-3 ${hasPack ? '' : 'imx-button-primary flex-1'}`}
                  >
                    <span>{PT_BR.home.prepareAndReview}</span>
                    <ArrowUpRight size={15} weight="bold" />
                  </Link>

                  {!isDemo && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteZone(zone.id)}
                      className="imx-glass-button imx-button-danger text-xs py-2 px-2.5"
                      title={PT_BR.home.deleteConfirm}
                      aria-label={PT_BR.home.deleteConfirm}
                    >
                      <Trash size={15} weight="regular" />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
