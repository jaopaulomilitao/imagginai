import {
  ArrowLeft,
  Brain,
  ChartBar,
  CheckCircle,
  Clock,
  DownloadSimple,
  Exam,
  Eye,
  Flask,
  Gauge,
  Goggles,
  HandPointing,
  Lightning,
  ShieldCheck,
  Sparkle,
  Target,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';
import { resolveBundledDemoPack, zoneStorage } from '../../shared/storage/dexie-db';
import type { StudyPack } from '../../shared/types/study-pack';
import type { SessionAggregateEnvelope } from '../../shared/types/telemetry';
import type { Zone } from '../../shared/types/zone';
import type { ZoneTheme } from '../../zone/config/constants';
import { AppNavbar } from '../components/app-navbar';
import { fetchTelemetryAggregatesRemote } from '../services/api-client';
import {
  buildResearchExportCsv,
  buildResearchExportJson,
  computeDashboardAnalytics,
  formatDurationHuman,
  generateSampleResearchAggregates,
} from '../services/dashboard-analytics';

export type DashboardLens = 'both' | 'student' | 'researcher';

export interface DashboardPageProps {
  readonly themeId: ZoneTheme;
  readonly onToggleTheme: () => void;
  readonly userEmail: string | null;
  readonly onOpenConsent: () => void;
  readonly onSignOut: () => void;
  readonly onRequestEnterZone: (zone: Zone) => void;
  readonly onDeleteAllData: () => Promise<void>;
}

function triggerFileDownload(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function DashboardPage({
  themeId,
  onToggleTheme,
  userEmail,
  onOpenConsent,
  onSignOut,
  onRequestEnterZone,
  onDeleteAllData,
}: DashboardPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialZoneFilter = searchParams.get('zoneId') ?? 'all';

  const [zones, setZones] = useState<Zone[]>([]);
  const [packsByZone, setPacksByZone] = useState<Record<string, StudyPack | undefined>>({});
  const [realAggregates, setRealAggregates] = useState<SessionAggregateEnvelope[]>([]);
  const [useDemoSimulation, setUseDemoSimulation] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<string>(initialZoneFilter);
  const [activeLens, setActiveLens] = useState<DashboardLens>('both');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletedNotice, setDeletedNotice] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadDashboardData = async () => {
      setLoading(true);
      try {
        const loadedZones = await zoneStorage.listZones();
        const packsMap: Record<string, StudyPack | undefined> = {};
        for (const z of loadedZones) {
          const storedPack = await zoneStorage.loadStudyPack(z.id);
          packsMap[z.id] = storedPack ?? resolveBundledDemoPack(z.id) ?? undefined;
        }

        let localAggs = await zoneStorage.listSessionAggregates();
        if (userEmail) {
          try {
            const remoteAggs = await fetchTelemetryAggregatesRemote();
            const mergedById = new Map<string, SessionAggregateEnvelope>();
            for (const item of localAggs) {
              mergedById.set(item.sessionId, item);
            }
            for (const remoteItem of remoteAggs) {
              mergedById.set(remoteItem.sessionId, remoteItem);
              await zoneStorage.saveSessionAggregate(remoteItem);
            }
            localAggs = [...mergedById.values()].sort((a, b) =>
              b.createdAt.localeCompare(a.createdAt),
            );
          } catch {
            // mantém os agregados locais quando offline
          }
        }

        if (!active) return;
        setZones(loadedZones);
        setPacksByZone(packsMap);
        setRealAggregates(localAggs);
        // ativa automaticamente a visualização demonstrativa caso ainda não haja sessões reais gravadas
        if (localAggs.length === 0) {
          setUseDemoSimulation(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadDashboardData();
    return () => {
      active = false;
    };
  }, [userEmail]);

  const sampleAggregates = useMemo(
    () => generateSampleResearchAggregates(packsByZone),
    [packsByZone],
  );

  const effectiveAggregates = useDemoSimulation ? sampleAggregates : realAggregates;

  const report = useMemo(
    () => computeDashboardAnalytics(effectiveAggregates, zones, packsByZone, selectedZoneId),
    [effectiveAggregates, zones, packsByZone, selectedZoneId],
  );

  const filteredSessions = useMemo(
    () =>
      selectedZoneId === 'all'
        ? effectiveAggregates
        : effectiveAggregates.filter((a) => a.zoneId === selectedZoneId),
    [effectiveAggregates, selectedZoneId],
  );

  const handleZoneFilterChange = (zoneId: string) => {
    setSelectedZoneId(zoneId);
    if (zoneId === 'all') {
      setSearchParams({});
    } else {
      setSearchParams({ zoneId });
    }
  };

  const handleExportJson = () => {
    const json = buildResearchExportJson(filteredSessions, zones);
    triggerFileDownload(
      `imagginai-telemetry-${selectedZoneId}-${new Date().toISOString().slice(0, 10)}.json`,
      json,
      'application/json;charset=utf-8',
    );
  };

  const handleExportCsv = () => {
    const csv = buildResearchExportCsv(filteredSessions, zones);
    triggerFileDownload(
      `imagginai-telemetry-${selectedZoneId}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8',
    );
  };

  const handleDeleteAllClick = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await onDeleteAllData();
    setRealAggregates([]);
    setUseDemoSimulation(false);
    setConfirmDelete(false);
    setDeletedNotice(true);
    window.setTimeout(() => setDeletedNotice(false), 4000);
  };

  const maxConceptFocusMs = Math.max(1000, ...report.concepts.map((c) => c.focusTimeMs));

  const showStudent = activeLens === 'both' || activeLens === 'student';
  const showResearcher = activeLens === 'both' || activeLens === 'researcher';

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
        {/* cabeçalho do painel analítico */}
        <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-[var(--imx-border-solid)]">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Link to="/" className="imx-glass-button text-xs py-1 px-2.5">
                <ArrowLeft size={14} weight="bold" />
                <span>{PT_BR.nav.zones}</span>
              </Link>
              <span className="imx-badge imx-badge-warm">
                <ChartBar size={14} weight="bold" />
                <span>{PT_BR.dashboard.badge}</span>
              </span>
            </div>
            <h1 className="imx-title">{PT_BR.dashboard.title}</h1>
            <p className="imx-subtitle m-0 max-w-3xl">{PT_BR.dashboard.subtitle}</p>
          </div>

          {/* controles de filtro por zona e alternância de lente (estudante / pesquisador) */}
          <div className="flex flex-col sm:items-end gap-2.5 w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar por Zona de Estudo"
                value={selectedZoneId}
                onChange={(e) => handleZoneFilterChange(e.target.value)}
                className="imx-input text-xs py-2 px-3 w-full sm:w-64"
              >
                <option value="all">{PT_BR.dashboard.filterAllZones}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setUseDemoSimulation((prev) => !prev)}
                className={`imx-glass-button text-xs py-2 px-3.5 ${
                  useDemoSimulation ? 'imx-button-accent' : ''
                }`}
              >
                <Sparkle size={16} weight="bold" />
                <span>
                  {useDemoSimulation
                    ? PT_BR.dashboard.clearDemoButton
                    : PT_BR.dashboard.seedDemoButton}
                </span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'both', label: PT_BR.dashboard.lensBoth },
                  { id: 'student', label: PT_BR.dashboard.lensStudent },
                  { id: 'researcher', label: PT_BR.dashboard.lensResearcher },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveLens(tab.id)}
                  className={`imx-glass-button text-xs py-1.5 px-3 ${
                    activeLens === tab.id ? 'imx-button-primary' : ''
                  }`}
                >
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* aviso quando estiver inspecionando dados simulados */}
        {useDemoSimulation && (
          <div
            className="imx-glass-card flex flex-wrap items-center justify-between gap-3"
            style={{ borderLeft: '4px solid var(--imx-accent-warm)' }}
          >
            <div className="flex items-start gap-3">
              <Flask
                size={22}
                weight="bold"
                style={{ color: 'var(--imx-accent-warm)', flexShrink: 0, marginTop: 2 }}
              />
              <div>
                <div
                  className="imx-heading text-sm font-bold"
                  style={{ color: 'var(--imx-text-title)' }}
                >
                  {PT_BR.dashboard.demoBannerTitle}
                </div>
                <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--imx-text-muted)' }}>
                  {PT_BR.dashboard.demoBannerSubtitle} (Sessões reais gravadas neste dispositivo:{' '}
                  <strong>{realAggregates.length}</strong>)
                </p>
              </div>
            </div>
            {realAggregates.length > 0 && (
              <button
                type="button"
                onClick={() => setUseDemoSimulation(false)}
                className="imx-glass-button text-xs py-1.5 px-3"
              >
                <span>Ver apenas minhas {realAggregates.length} sessões reais</span>
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="imx-glass-card text-sm" style={{ color: 'var(--imx-text-muted)' }}>
            Carregando indicadores analíticos...
          </div>
        )}

        {/* =====================================================================
            LENTE 1: VISÃO DO ESTUDANTE (METACOGNIÇÃO E REVISÃO ORIENTADA)
           ===================================================================== */}
        {showStudent && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-2">
              <span className="imx-badge imx-badge-lightblue">
                <Brain size={15} weight="bold" />
                <span>{PT_BR.dashboard.lensStudent}</span>
              </span>
            </div>

            {/* 4 kpis principais do estudante com explicação pedagógica */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div
                className="imx-glass-card flex flex-col justify-between gap-2"
                style={{ borderTop: '3px solid var(--imx-accent-warm)' }}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--imx-text-muted)' }}
                    >
                      {PT_BR.dashboard.studentKpis.focusTimeTitle}
                    </span>
                    <Clock size={18} weight="bold" style={{ color: 'var(--imx-accent-warm)' }} />
                  </div>
                  <div
                    className="imx-display-font text-3xl font-extrabold"
                    style={{ color: 'var(--imx-text-title)' }}
                  >
                    {report.formattedFocusTime}
                  </div>
                </div>
                <p
                  className="text-xs m-0 leading-relaxed"
                  style={{ color: 'var(--imx-text-muted)' }}
                >
                  {PT_BR.dashboard.studentKpis.focusTimeExplain}
                </p>
              </div>

              <div
                className="imx-glass-card flex flex-col justify-between gap-2"
                style={{ borderTop: '3px solid var(--imx-cat-lightblue)' }}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--imx-text-muted)' }}
                    >
                      {PT_BR.dashboard.studentKpis.quizAccuracyTitle}
                    </span>
                    <Exam size={18} weight="bold" style={{ color: 'var(--imx-cat-lightblue)' }} />
                  </div>
                  <div
                    className="imx-display-font text-3xl font-extrabold"
                    style={{ color: 'var(--imx-text-title)' }}
                  >
                    {report.overallQuizAccuracyPct !== null
                      ? `${report.overallQuizAccuracyPct}%`
                      : '—'}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--imx-text-body)' }}>
                    {report.overallQuizCorrect} acertos em {report.overallQuizTotal} questões
                  </div>
                </div>
                <p
                  className="text-xs m-0 leading-relaxed"
                  style={{ color: 'var(--imx-text-muted)' }}
                >
                  {PT_BR.dashboard.studentKpis.quizAccuracyExplain}
                </p>
              </div>

              <div
                className="imx-glass-card flex flex-col justify-between gap-2"
                style={{ borderTop: '3px solid var(--imx-cat-darkblue)' }}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--imx-text-muted)' }}
                    >
                      {PT_BR.dashboard.studentKpis.conceptCoverageTitle}
                    </span>
                    <Target size={18} weight="bold" style={{ color: 'var(--imx-cat-lightblue)' }} />
                  </div>
                  <div
                    className="imx-display-font text-3xl font-extrabold"
                    style={{ color: 'var(--imx-text-title)' }}
                  >
                    {report.conceptCoveragePct}%
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--imx-text-body)' }}>
                    {report.exploredConceptsCount} de {report.totalConceptsCount} conceitos
                    inspecionados
                  </div>
                </div>
                <p
                  className="text-xs m-0 leading-relaxed"
                  style={{ color: 'var(--imx-text-muted)' }}
                >
                  {PT_BR.dashboard.studentKpis.conceptCoverageExplain}
                </p>
              </div>

              <div
                className="imx-glass-card flex flex-col justify-between gap-2"
                style={{ borderTop: '3px solid #16a34a' }}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--imx-text-muted)' }}
                    >
                      {PT_BR.dashboard.studentKpis.sessionsTitle}
                    </span>
                    <Lightning size={18} weight="bold" style={{ color: '#16a34a' }} />
                  </div>
                  <div
                    className="imx-display-font text-3xl font-extrabold"
                    style={{ color: 'var(--imx-text-title)' }}
                  >
                    {report.totalSessions}{' '}
                    <span className="text-base font-normal">
                      ({report.totalPomodoroBlocks} Pomodoros)
                    </span>
                  </div>
                </div>
                <p
                  className="text-xs m-0 leading-relaxed"
                  style={{ color: 'var(--imx-text-muted)' }}
                >
                  {PT_BR.dashboard.studentKpis.sessionsExplain}
                </p>
              </div>
            </div>

            {/* recomendações prioritárias de revisão */}
            {report.priorityReviewConcepts.length > 0 && (
              <div
                className="imx-glass-card flex flex-col gap-3"
                style={{ borderLeft: '4px solid var(--imx-cat-lightblue)' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2
                      className="imx-heading text-base font-extrabold m-0"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.dashboard.conceptsSection.priorityReviewTitle}
                    </h2>
                    <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--imx-text-muted)' }}>
                      {PT_BR.dashboard.conceptsSection.priorityReviewExplain}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {report.priorityReviewConcepts.slice(0, 3).map((item) => {
                    const targetZone = zones.find((z) => z.id === item.zoneId);
                    return (
                      <div
                        key={`${item.zoneId}-${item.conceptId}`}
                        className="p-3 rounded-[10px] border border-[var(--imx-border-subtle)] flex flex-col justify-between gap-2"
                        style={{ background: 'var(--imx-bg-elevated)' }}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="imx-badge imx-badge-warm">Pág. {item.sourcePage}</span>
                            <span
                              className="text-xs font-semibold"
                              style={{ color: 'var(--imx-text-muted)' }}
                            >
                              Foco: {formatDurationHuman(item.focusTimeMs)}
                            </span>
                          </div>
                          <div
                            className="imx-heading text-sm font-bold"
                            style={{ color: 'var(--imx-text-title)' }}
                          >
                            {item.label}
                          </div>
                          <div className="text-xs mt-1" style={{ color: 'var(--imx-text-muted)' }}>
                            {item.zoneName} • Quiz:{' '}
                            {item.quizAccuracyPct !== null
                              ? `${item.quizAccuracyPct}%`
                              : 'Não testado'}
                          </div>
                        </div>

                        {targetZone && (
                          <button
                            type="button"
                            onClick={() => onRequestEnterZone(targetZone)}
                            className="imx-glass-button imx-button-accent text-xs py-1.5 px-3 w-full mt-1"
                          >
                            <Goggles size={15} weight="bold" />
                            <span>Revisar na Zona VR</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* comparativo lado a lado: conceitos mais explorados vs. menos explorados */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* mais explorados */}
              <div className="imx-glass-card flex flex-col gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Eye size={18} weight="bold" style={{ color: 'var(--imx-cat-lightblue)' }} />
                    <h2
                      className="imx-heading text-base font-extrabold m-0"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.dashboard.conceptsSection.mostExploredTitle}
                    </h2>
                  </div>
                  <p className="text-xs m-0" style={{ color: 'var(--imx-text-muted)' }}>
                    {PT_BR.dashboard.conceptsSection.mostExploredExplain}
                  </p>
                </div>

                <div className="flex flex-col gap-2.5">
                  {report.mostExploredConcepts.map((c) => {
                    const widthPct = Math.max(
                      6,
                      Math.min(100, Math.round((c.focusTimeMs / maxConceptFocusMs) * 100)),
                    );
                    return (
                      <div
                        key={`most-${c.zoneId}-${c.conceptId}`}
                        className="p-2.5 rounded-[8px] border border-[var(--imx-border-subtle)]"
                        style={{ background: 'var(--imx-bg-elevated)' }}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span
                            className="font-bold truncate"
                            style={{ color: 'var(--imx-text-title)' }}
                          >
                            {c.label}
                          </span>
                          <span className="imx-display-font font-bold shrink-0">
                            {formatDurationHuman(c.focusTimeMs)} ({c.opens}x)
                          </span>
                        </div>
                        <div
                          className="w-full h-2 rounded-full overflow-hidden mb-1.5"
                          style={{ background: 'var(--imx-border-subtle)' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${widthPct}%`,
                              background: 'var(--imx-cat-lightblue)',
                            }}
                          />
                        </div>
                        <div
                          className="flex items-center justify-between text-[11px]"
                          style={{ color: 'var(--imx-text-muted)' }}
                        >
                          <span>
                            {c.zoneName} • Pág. {c.sourcePage}
                          </span>
                          <span>{PT_BR.dashboard.bucketLabels[c.timeBucket]}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* menos explorados */}
              <div className="imx-glass-card flex flex-col gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <WarningCircle
                      size={18}
                      weight="bold"
                      style={{ color: 'var(--imx-accent-warm)' }}
                    />
                    <h2
                      className="imx-heading text-base font-extrabold m-0"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.dashboard.conceptsSection.leastExploredTitle}
                    </h2>
                  </div>
                  <p className="text-xs m-0" style={{ color: 'var(--imx-text-muted)' }}>
                    {PT_BR.dashboard.conceptsSection.leastExploredExplain}
                  </p>
                </div>

                <div className="flex flex-col gap-2.5">
                  {report.leastExploredConcepts.map((c) => {
                    const widthPct =
                      c.focusTimeMs > 0
                        ? Math.max(
                            6,
                            Math.min(100, Math.round((c.focusTimeMs / maxConceptFocusMs) * 100)),
                          )
                        : 2;
                    return (
                      <div
                        key={`least-${c.zoneId}-${c.conceptId}`}
                        className="p-2.5 rounded-[8px] border border-[var(--imx-border-subtle)]"
                        style={{ background: 'var(--imx-bg-elevated)' }}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs mb-1">
                          <span
                            className="font-bold truncate"
                            style={{ color: 'var(--imx-text-title)' }}
                          >
                            {c.label}
                          </span>
                          <span className="imx-display-font font-bold shrink-0">
                            {formatDurationHuman(c.focusTimeMs)} ({c.opens}x)
                          </span>
                        </div>
                        <div
                          className="w-full h-2 rounded-full overflow-hidden mb-1.5"
                          style={{ background: 'var(--imx-border-subtle)' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${widthPct}%`,
                              background: 'var(--imx-accent-warm)',
                            }}
                          />
                        </div>
                        <div
                          className="flex items-center justify-between text-[11px]"
                          style={{ color: 'var(--imx-text-muted)' }}
                        >
                          <span>
                            {c.zoneName} • Pág. {c.sourcePage}
                          </span>
                          <span>{PT_BR.dashboard.bucketLabels[c.timeBucket]}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* acurácia de quiz por conceito */}
            <div className="imx-glass-card flex flex-col gap-3">
              <div>
                <h2
                  className="imx-heading text-base font-extrabold m-0"
                  style={{ color: 'var(--imx-text-title)' }}
                >
                  {PT_BR.dashboard.conceptsSection.quizPerConceptTitle}
                </h2>
                <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--imx-text-muted)' }}>
                  {PT_BR.dashboard.conceptsSection.quizPerConceptExplain}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {report.concepts.slice(0, 12).map((c) => {
                  const badgeClass =
                    c.masteryStatus === 'mastered'
                      ? 'imx-badge-lightblue'
                      : c.masteryStatus === 'needs-review'
                        ? 'imx-badge-warm'
                        : 'imx-badge-darkblue';

                  return (
                    <div
                      key={`quiz-${c.zoneId}-${c.conceptId}`}
                      className="p-3 rounded-[10px] border border-[var(--imx-border-subtle)] flex flex-col justify-between gap-2"
                      style={{ background: 'var(--imx-bg-elevated)' }}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={`imx-badge ${badgeClass}`}>
                            {PT_BR.dashboard.masteryLabels[c.masteryStatus]}
                          </span>
                          <span
                            className="text-xs font-bold imx-display-font"
                            style={{ color: 'var(--imx-text-title)' }}
                          >
                            {c.quizAccuracyPct !== null ? `${c.quizAccuracyPct}%` : '—'}
                          </span>
                        </div>
                        <div
                          className="font-bold text-sm truncate"
                          style={{ color: 'var(--imx-text-title)' }}
                        >
                          {c.label}
                        </div>
                      </div>

                      <div>
                        <div
                          className="w-full h-1.5 rounded-full overflow-hidden mb-1.5"
                          style={{ background: 'var(--imx-border-subtle)' }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${c.quizAccuracyPct ?? 0}%`,
                              background:
                                c.masteryStatus === 'mastered'
                                  ? '#16a34a'
                                  : c.masteryStatus === 'needs-review'
                                    ? 'var(--imx-accent-warm)'
                                    : 'var(--imx-cat-lightblue)',
                            }}
                          />
                        </div>
                        <div
                          className="flex items-center justify-between text-[11px]"
                          style={{ color: 'var(--imx-text-muted)' }}
                        >
                          <span>
                            {c.quizCorrect} acertos / {c.quizTotal} tentativas
                          </span>
                          <span>Pág. {c.sourcePage}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            LENTE 2: VISÃO DO PESQUISADOR EM EDUCAÇÃO & IHC ESPACIAL (WEBXR)
           ===================================================================== */}
        {showResearcher && (
          <div className="flex flex-col gap-6 pt-4 border-t border-[var(--imx-border-solid)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <span className="imx-badge imx-badge-darkblue mb-2">
                  <Flask size={14} weight="bold" />
                  <span>{PT_BR.dashboard.researcherSection.badge}</span>
                </span>
                <h2 className="imx-title text-2xl">{PT_BR.dashboard.researcherSection.title}</h2>
                <p className="imx-subtitle text-sm m-0 max-w-3xl">
                  {PT_BR.dashboard.researcherSection.subtitle}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExportJson}
                  className="imx-glass-button text-xs py-2 px-3.5"
                >
                  <DownloadSimple size={16} weight="bold" />
                  <span>{PT_BR.dashboard.researcherSection.exportJsonButton}</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="imx-glass-button imx-button-primary text-xs py-2 px-3.5"
                >
                  <DownloadSimple size={16} weight="bold" />
                  <span>{PT_BR.dashboard.researcherSection.exportCsvButton}</span>
                </button>
              </div>
            </div>

            {/* 4 indicadores científicos explicados para o pesquisador */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 1. ergonomia biomecânica de pinça */}
              <div className="imx-glass-card flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="imx-heading text-sm font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.dashboard.researcherSection.pinchTitle}
                    </span>
                    <HandPointing
                      size={20}
                      weight="bold"
                      style={{ color: 'var(--imx-cat-lightblue)' }}
                    />
                  </div>
                  <p
                    className="text-xs m-0 leading-relaxed"
                    style={{ color: 'var(--imx-text-muted)' }}
                  >
                    {PT_BR.dashboard.researcherSection.pinchExplain}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--imx-border-subtle)]">
                  <div>
                    <div
                      className="imx-display-font text-xl font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {report.overallPinchSuccessRatePct}%
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--imx-text-muted)' }}>
                      Taxa de Sucesso ({report.totalPinchSuccess} hits)
                    </div>
                  </div>
                  <div>
                    <div
                      className="imx-display-font text-xl font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {report.totalPinchMiss}
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--imx-text-muted)' }}>
                      Pinças sem alvo (Miss)
                    </div>
                  </div>
                  <div>
                    <div
                      className="imx-display-font text-xl font-extrabold"
                      style={{ color: 'var(--imx-accent-warm)' }}
                    >
                      {report.totalPinchRepeat} ({report.pinchFrictionRatePct}%)
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--imx-text-muted)' }}>
                      Repetições &lt; 1s (Atrito)
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. distribuição cognitiva por buckets de atenção (0-5s, 5-30s, >30s) */}
              <div className="imx-glass-card flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="imx-heading text-sm font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.dashboard.researcherSection.bucketsTitle}
                    </span>
                    <Brain size={20} weight="bold" style={{ color: 'var(--imx-accent-warm)' }} />
                  </div>
                  <p
                    className="text-xs m-0 leading-relaxed"
                    style={{ color: 'var(--imx-text-muted)' }}
                  >
                    {PT_BR.dashboard.researcherSection.bucketsExplain}
                  </p>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-[var(--imx-border-subtle)]">
                  <div className="w-full h-3 rounded-full overflow-hidden flex">
                    <div
                      style={{
                        width: `${report.bucketDistribution.pct0to5s}%`,
                        background: '#94a3b8',
                      }}
                      title="0-5s"
                    />
                    <div
                      style={{
                        width: `${report.bucketDistribution.pct5to30s}%`,
                        background: 'var(--imx-cat-lightblue)',
                      }}
                      title="5-30s"
                    />
                    <div
                      style={{
                        width: `${report.bucketDistribution.pctOver30s}%`,
                        background: 'var(--imx-accent-warm)',
                      }}
                      title=">30s"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="font-bold" style={{ color: 'var(--imx-text-title)' }}>
                        0–5s:{' '}
                      </span>
                      <span>
                        {report.bucketDistribution['0-5s']} ({report.bucketDistribution.pct0to5s}%)
                      </span>
                    </div>
                    <div>
                      <span className="font-bold" style={{ color: 'var(--imx-text-title)' }}>
                        5–30s:{' '}
                      </span>
                      <span>
                        {report.bucketDistribution['5-30s']} ({report.bucketDistribution.pct5to30s}
                        %)
                      </span>
                    </div>
                    <div>
                      <span className="font-bold" style={{ color: 'var(--imx-text-title)' }}>
                        &gt;30s:{' '}
                      </span>
                      <span>
                        {report.bucketDistribution['>30s']} ({report.bucketDistribution.pctOver30s}
                        %)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. preferência ecológica de modo: foco vs passthrough */}
              <div className="imx-glass-card flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="imx-heading text-sm font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.dashboard.researcherSection.modeTitle}
                    </span>
                    <Goggles
                      size={20}
                      weight="bold"
                      style={{ color: 'var(--imx-cat-lightblue)' }}
                    />
                  </div>
                  <p
                    className="text-xs m-0 leading-relaxed"
                    style={{ color: 'var(--imx-text-muted)' }}
                  >
                    {PT_BR.dashboard.researcherSection.modeExplain}
                  </p>
                </div>

                <div className="flex flex-col gap-2 pt-2 border-t border-[var(--imx-border-subtle)]">
                  <div className="w-full h-3 rounded-full overflow-hidden flex">
                    <div
                      style={{
                        width: `${report.modeDistribution.focusPct}%`,
                        background: 'var(--imx-cat-darkblue)',
                      }}
                    />
                    <div
                      style={{
                        width: `${report.modeDistribution.passthroughPct}%`,
                        background: 'var(--imx-accent-warm)',
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      <strong>Modo Foco Isolado:</strong>{' '}
                      {formatDurationHuman(report.modeDistribution.focusMs)} (
                      {report.modeDistribution.focusPct}%)
                    </span>
                    <span>
                      <strong>Passthrough AR:</strong>{' '}
                      {formatDurationHuman(report.modeDistribution.passthroughMs)} (
                      {report.modeDistribution.passthroughPct}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. estabilidade de quadros e conforto visual (fps p50 / p10) */}
              <div className="imx-glass-card flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className="imx-heading text-sm font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.dashboard.researcherSection.fpsTitle}
                    </span>
                    <Gauge size={20} weight="bold" style={{ color: '#16a34a' }} />
                  </div>
                  <p
                    className="text-xs m-0 leading-relaxed"
                    style={{ color: 'var(--imx-text-muted)' }}
                  >
                    {PT_BR.dashboard.researcherSection.fpsExplain}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--imx-border-subtle)]">
                  <div>
                    <div
                      className="imx-display-font text-xl font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {report.meanFpsP50} FPS
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--imx-text-muted)' }}>
                      Mediana (P50)
                    </div>
                  </div>
                  <div>
                    <div
                      className="imx-display-font text-xl font-extrabold"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {report.meanFpsP10} FPS
                    </div>
                    <div className="text-[11px]" style={{ color: 'var(--imx-text-muted)' }}>
                      Percentil 10 (P10)
                    </div>
                  </div>
                  <div>
                    <span
                      className={`imx-badge ${
                        report.comfortTargetMet ? 'imx-badge-lightblue' : 'imx-badge-warm'
                      }`}
                    >
                      {report.comfortTargetMet ? 'Meta ≥ 50 FPS OK' : 'Abaixo da meta'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* tabela de sessões registradas */}
            <div className="imx-glass-card flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3
                  className="imx-heading text-base font-extrabold m-0"
                  style={{ color: 'var(--imx-text-title)' }}
                >
                  {PT_BR.dashboard.researcherSection.sessionsTableTitle} ({filteredSessions.length})
                </h3>
                <span className="text-xs" style={{ color: 'var(--imx-text-muted)' }}>
                  Sincronizadas com nuvem: {report.syncedSessionsCount} | Locais:{' '}
                  {report.unsyncedSessionsCount}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr
                      className="border-b border-[var(--imx-border-solid)]"
                      style={{ color: 'var(--imx-text-muted)' }}
                    >
                      <th className="py-2 pr-3">Sessão</th>
                      <th className="py-2 px-3">Zona</th>
                      <th className="py-2 px-3">Data</th>
                      <th className="py-2 px-3">Foco Total</th>
                      <th className="py-2 px-3">Pomodoros</th>
                      <th className="py-2 px-3">Pinça OK</th>
                      <th className="py-2 pl-3">FPS P50 / P10</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSessions.map((env) => {
                      const zName = zones.find((z) => z.id === env.zoneId)?.name ?? env.zoneId;
                      return (
                        <tr
                          key={env.sessionId}
                          className="border-b border-[var(--imx-border-subtle)]"
                          style={{ color: 'var(--imx-text-body)' }}
                        >
                          <td className="py-2.5 pr-3 imx-display-font font-semibold">
                            {env.sessionId.slice(0, 18)}
                          </td>
                          <td className="py-2.5 px-3 font-medium">{zName}</td>
                          <td className="py-2.5 px-3">
                            {new Date(env.createdAt).toLocaleString('pt-BR')}
                          </td>
                          <td className="py-2.5 px-3 imx-display-font">
                            {formatDurationHuman(env.payload.totalFocusTimeMs)}
                          </td>
                          <td className="py-2.5 px-3 imx-display-font">
                            {env.payload.completedPomodoroBlocks}
                          </td>
                          <td className="py-2.5 px-3 imx-display-font">
                            {Math.round(env.payload.pinchSuccessRate * 100)}%
                          </td>
                          <td className="py-2.5 pl-3 imx-display-font">
                            {env.payload.fpsP50} / {env.payload.fpsP10}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* auditoria de privacidade e exclusão integral de dados (lgpd / seção 3.9) */}
            <div className="imx-glass-card flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3 max-w-2xl">
                <ShieldCheck
                  size={24}
                  weight="bold"
                  style={{ color: '#16a34a', flexShrink: 0, marginTop: 2 }}
                />
                <div>
                  <div
                    className="imx-heading text-sm font-bold flex items-center gap-1.5"
                    style={{ color: 'var(--imx-text-title)' }}
                  >
                    <span>Garantia de Privacidade Biométrica (Seção 3.9)</span>
                    {report.privacyAuditPassed && (
                      <CheckCircle size={16} weight="bold" style={{ color: '#16a34a' }} />
                    )}
                  </div>
                  <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--imx-text-muted)' }}>
                    {PT_BR.dashboard.researcherSection.privacyAuditOk}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {deletedNotice && (
                  <span className="imx-badge imx-badge-warm">{PT_BR.consent.deleteMyDataDone}</span>
                )}
                <button
                  type="button"
                  onClick={() => void handleDeleteAllClick()}
                  className="imx-glass-button imx-button-danger text-xs py-2 px-3.5"
                >
                  <Trash size={16} weight="bold" />
                  <span>
                    {confirmDelete
                      ? PT_BR.consent.deleteMyDataConfirm
                      : PT_BR.consent.deleteMyDataButton}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
