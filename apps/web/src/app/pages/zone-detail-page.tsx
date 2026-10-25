import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Cards,
  Check,
  CloudArrowUp,
  Cube,
  Exam,
  FilePdf,
  Goggles,
  LockSimple,
  PencilSimple,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';
import { zoneStorage } from '../../shared/storage/dexie-db';
import type { StudyPack } from '../../shared/types/study-pack';
import type { Zone } from '../../shared/types/zone';
import type { ZoneTheme } from '../../zone/config/constants';
import { AppNavbar } from '../components/app-navbar';
import {
  createZoneRemote,
  fetchJobStatus,
  fetchZoneStudyPack,
  updateZoneRemote,
  uploadZoneSourcePdf,
} from '../services/api-client';
import { removeConceptFromPack, renameConceptInPack } from '../services/pack-customizer';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type WizardStep = 1 | 2 | 3 | 4;
export type ReviewCategoryFilter = 'all' | 'concepts' | 'flashcards' | 'quiz' | 'studyObjects';

export interface ZoneDetailPageProps {
  readonly themeId: ZoneTheme;
  readonly onToggleTheme: () => void;
  readonly userEmail: string | null;
  readonly onOpenConsent: () => void;
  readonly onSignOut: () => void;
  readonly onRequestEnterZone: (zone: Zone) => void;
}

function describeJobStage(progress: number, status: string): string {
  if (status === 'done' || progress >= 100) return PT_BR.zoneDetail.jobStages.done;
  if (progress >= 90) return PT_BR.zoneDetail.jobStages.generating;
  if (progress >= 80) return PT_BR.zoneDetail.jobStages.storing;
  if (progress >= 50) return PT_BR.zoneDetail.jobStages.embedding;
  if (progress >= 15) return PT_BR.zoneDetail.jobStages.extracting;
  return PT_BR.zoneDetail.jobStages.queued;
}

export function ZoneDetailPage({
  themeId,
  onToggleTheme,
  userEmail,
  onOpenConsent,
  onSignOut,
  onRequestEnterZone,
}: ZoneDetailPageProps) {
  const { zoneId = 'demo' } = useParams<{ zoneId: string }>();
  const [zone, setZone] = useState<Zone | null>(null);
  const [pack, setPack] = useState<StudyPack | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [settingsSaved, setSettingsSaved] = useState(false);

  const [activeStep, setActiveStep] = useState<WizardStep>(1);
  const [categoryFilter, setCategoryFilter] = useState<ReviewCategoryFilter>('all');

  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [docTitle, setDocTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [jobProgress, setJobProgress] = useState<number | null>(null);
  const [jobStageText, setJobStageText] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [editingConceptId, setEditingConceptId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftDef, setDraftDef] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const loadedZone = await zoneStorage.getZone(zoneId);
      const loadedPack = await zoneStorage.loadStudyPack(zoneId);
      if (!active) return;
      if (loadedZone) {
        setZone(loadedZone);
        setZoneName(loadedZone.name);
      }
      // inicia vazio e bloqueado na etapa 1 caso nenhum pdf tenha sido processado para esta zona
      if (loadedPack && loadedZone?.packId) {
        setPack(loadedPack);
        setActiveStep(3);
      } else {
        setPack(null);
        setActiveStep(1);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [zoneId]);

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!zone || !zoneName.trim()) return;
    const updated: Zone = {
      ...zone,
      name: zoneName.trim(),
      updatedAt: new Date().toISOString(),
    };
    await zoneStorage.saveZone(updated);
    if (userEmail && UUID_REGEX.test(zone.id)) {
      try {
        await updateZoneRemote(zone.id, {
          name: updated.name,
          environment: updated.environment,
        });
      } catch {
        // mantém a atualização local caso a api esteja offline
      }
    }
    setZone(updated);
    setSettingsSaved(true);
    window.setTimeout(() => setSettingsSaved(false), 2500);
  };

  const handleUploadPdf = async (event: FormEvent) => {
    event.preventDefault();
    if (!zone || selectedFiles.length === 0) return;
    setUploadError(null);

    for (const file of selectedFiles) {
      if (file.size > MAX_PDF_BYTES) {
        setUploadError(`O arquivo "${file.name}" excede o limite máximo de 20 MB.`);
        return;
      }
    }

    setUploading(true);
    setActiveStep(2);
    setJobProgress(8);
    setJobStageText(PT_BR.zoneDetail.jobStages.queued);

    try {
      let remoteZoneId = zone.id;
      if (!UUID_REGEX.test(remoteZoneId)) {
        const createdRemote = await createZoneRemote({
          name: zone.name,
          environment: zone.environment,
        });
        remoteZoneId = createdRemote.id;
      }

      for (let idx = 0; idx < selectedFiles.length; idx++) {
        const file = selectedFiles[idx];
        if (!file) continue;
        const prefix = selectedFiles.length > 1 ? `[PDF ${idx + 1}/${selectedFiles.length}] ` : '';

        const buffer = await file.arrayBuffer();
        const effectiveTitle =
          selectedFiles.length === 1 && docTitle.trim()
            ? docTitle.trim()
            : file.name.replace(/\.pdf$/i, '');
        const storedPdfRecord = {
          zoneId: zone.id,
          sourceId: `local-${Date.now()}-${idx}`,
          title: effectiveTitle,
          data: new Uint8Array(buffer),
          savedAt: new Date().toISOString(),
        };
        await zoneStorage.savePdfFile(storedPdfRecord);
        if (remoteZoneId !== zone.id) {
          await zoneStorage.savePdfFile({
            ...storedPdfRecord,
            zoneId: remoteZoneId,
          });
        }

        const uploadRes = await uploadZoneSourcePdf(remoteZoneId, file, effectiveTitle);

        let finished = false;
        while (!finished) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          const statusRes = await fetchJobStatus(uploadRes.jobId);
          setJobProgress(statusRes.progress);
          setJobStageText(`${prefix}${describeJobStage(statusRes.progress, statusRes.status)}`);

          if (statusRes.status === 'failed') {
            throw new Error(statusRes.message ?? 'O processamento do PDF falhou.');
          }
          if (statusRes.status === 'done') {
            finished = true;
          }
        }
      }

      const generatedPack = await fetchZoneStudyPack(remoteZoneId);
      const boundPack: StudyPack = { ...generatedPack, zoneId: zone.id };
      await zoneStorage.saveStudyPack(zone.id, boundPack);
      setPack(boundPack);
      setSelectedFiles([]);
      setDocTitle('');

      const refreshedZone = await zoneStorage.getZone(zone.id);
      if (refreshedZone) setZone(refreshedZone);
      setJobProgress(100);
      setJobStageText(PT_BR.zoneDetail.jobStages.done);
      setActiveStep(3);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setUploadError(`${PT_BR.zoneDetail.jobStages.failed} ${msg}`);
      setActiveStep(1);
    } finally {
      setUploading(false);
    }
  };

  const handleStartEditConcept = (conceptId: string, label: string, definition: string) => {
    setEditingConceptId(conceptId);
    setDraftLabel(label);
    setDraftDef(definition);
  };

  const handleCommitEditConcept = async (conceptId: string) => {
    if (!pack || !zone) return;
    const nextPack = renameConceptInPack(pack, conceptId, draftLabel, draftDef);
    setPack(nextPack);
    setEditingConceptId(null);
    await zoneStorage.saveStudyPack(zone.id, nextPack);
  };

  const handleRemoveConcept = async (conceptId: string) => {
    if (!pack || !zone) return;
    const nextPack = removeConceptFromPack(pack, conceptId);
    setPack(nextPack);
    await zoneStorage.saveStudyPack(zone.id, nextPack);
  };

  const handleToggleQuizAnswered = async (quizId: string, answered: boolean) => {
    if (!pack || !zone) return;
    const updatedQuiz = pack.quiz.map((q) => (q.id === quizId ? { ...q, answered } : q));
    const nextPack = { ...pack, quiz: updatedQuiz };
    setPack(nextPack);
    await zoneStorage.saveStudyPack(zone.id, nextPack);
  };

  const hasProcessedPack = pack !== null;

  const showConcepts = categoryFilter === 'all' || categoryFilter === 'concepts';
  const showFlashcards = categoryFilter === 'all' || categoryFilter === 'flashcards';
  const showQuiz = categoryFilter === 'all' || categoryFilter === 'quiz';
  const showStudyObjects = categoryFilter === 'all' || categoryFilter === 'studyObjects';

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
        {/* cabeçalho da zona */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--imx-border-solid)]">
          <Link to="/" className="imx-glass-button text-xs py-2 px-3.5">
            <ArrowLeft size={16} weight="bold" />
            <span>{PT_BR.zoneDetail.backToZones}</span>
          </Link>

          {zone && hasProcessedPack && (
            <button
              type="button"
              onClick={() => onRequestEnterZone(zone)}
              className="imx-glass-button imx-button-accent text-xs py-2.5 px-5"
            >
              <Goggles size={18} weight="bold" />
              <span>{PT_BR.zoneDetail.enterZoneButton}</span>
            </button>
          )}
        </div>

        {/* ajuste rápido do nome da zona */}
        {zone && (
          <form
            onSubmit={(e) => void handleSaveSettings(e)}
            className="imx-glass-card flex flex-wrap items-end gap-3.5"
          >
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 imx-display-font">
                {PT_BR.home.zoneNameLabel}
              </label>
              <input
                type="text"
                maxLength={80}
                required
                value={zoneName}
                onChange={(e) => setZoneName(e.target.value)}
                className="imx-input"
              />
            </div>

            <button type="submit" className="imx-glass-button text-xs py-2.5 px-4">
              <span>{PT_BR.zoneDetail.saveSettingsButton}</span>
            </button>

            {settingsSaved && (
              <span className="imx-badge imx-badge-darkblue py-1.5">
                <Check size={14} weight="bold" />
                <span>{PT_BR.zoneDetail.savedBadge}</span>
              </span>
            )}
          </form>
        )}

        {/* barra do setup wizard de 4 etapas */}
        <nav className="imx-wizard-bar" aria-label="Etapas de preparação do estudo">
          <button
            type="button"
            disabled={uploading}
            onClick={() => setActiveStep(1)}
            className={`imx-wizard-step ${activeStep === 1 ? 'imx-wizard-step-active' : ''}`}
          >
            <span className="text-xs font-bold px-2 py-0.5 rounded border border-current">01</span>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">
                {PT_BR.zoneDetail.wizardSteps.step1Title}
              </div>
              <div className="text-[11px] opacity-75">{PT_BR.zoneDetail.wizardSteps.step1Desc}</div>
            </div>
          </button>

          <button
            type="button"
            disabled={!uploading && jobProgress === null}
            onClick={() => setActiveStep(2)}
            className={`imx-wizard-step ${activeStep === 2 ? 'imx-wizard-step-active' : ''}`}
          >
            <span className="text-xs font-bold px-2 py-0.5 rounded border border-current">02</span>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">
                {PT_BR.zoneDetail.wizardSteps.step2Title}
              </div>
              <div className="text-[11px] opacity-75">{PT_BR.zoneDetail.wizardSteps.step2Desc}</div>
            </div>
          </button>

          <button
            type="button"
            disabled={!hasProcessedPack || uploading}
            onClick={() => setActiveStep(3)}
            className={`imx-wizard-step ${activeStep === 3 ? 'imx-wizard-step-active' : ''}`}
          >
            <span className="text-xs font-bold px-2 py-0.5 rounded border border-current">
              {hasProcessedPack ? '03' : <LockSimple size={12} weight="bold" />}
            </span>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">
                {PT_BR.zoneDetail.wizardSteps.step3Title}
              </div>
              <div className="text-[11px] opacity-75">{PT_BR.zoneDetail.wizardSteps.step3Desc}</div>
            </div>
          </button>

          <button
            type="button"
            disabled={!hasProcessedPack || uploading}
            onClick={() => setActiveStep(4)}
            className={`imx-wizard-step ${activeStep === 4 ? 'imx-wizard-step-active' : ''}`}
          >
            <span className="text-xs font-bold px-2 py-0.5 rounded border border-current">
              {hasProcessedPack ? '04' : <LockSimple size={12} weight="bold" />}
            </span>
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">
                {PT_BR.zoneDetail.wizardSteps.step4Title}
              </div>
              <div className="text-[11px] opacity-75">{PT_BR.zoneDetail.wizardSteps.step4Desc}</div>
            </div>
          </button>
        </nav>

        {/* etapa 1: envio de documentos pdf */}
        {activeStep === 1 && (
          <div className="imx-glass-card">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="imx-badge imx-badge-darkblue">Etapa 01</span>
              {hasProcessedPack && (
                <button
                  type="button"
                  onClick={() => setActiveStep(3)}
                  className="imx-glass-button text-xs py-1.5 px-3"
                >
                  <span>Ir para Revisão</span>
                  <ArrowRight size={14} weight="bold" />
                </button>
              )}
            </div>

            <h2
              className="imx-heading text-xl font-extrabold m-0 mb-1.5"
              style={{ color: 'var(--imx-text-title)' }}
            >
              {PT_BR.zoneDetail.uploadSectionTitle}
            </h2>
            <p className="text-sm mb-5" style={{ color: 'var(--imx-text-muted)' }}>
              {PT_BR.zoneDetail.uploadSectionSubtitle}
            </p>

            {!userEmail && (
              <div className="imx-badge imx-badge-warm w-full justify-start py-2.5 px-3.5 mb-4 text-xs normal-case">
                <WarningCircle size={18} weight="regular" className="shrink-0" />
                <span>{PT_BR.zoneDetail.authRequiredNotice}</span>
              </div>
            )}

            <form
              onSubmit={(e) => void handleUploadPdf(e)}
              className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end"
            >
              <div className="md:col-span-5">
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 imx-display-font">
                  {PT_BR.zoneDetail.selectPdfLabel}
                </label>
                <input
                  type="file"
                  multiple
                  accept="application/pdf,.pdf"
                  onChange={(e) => setSelectedFiles(Array.from(e.target.files ?? []))}
                  className="imx-input text-sm"
                />
              </div>

              <div className="md:col-span-4">
                <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 imx-display-font">
                  {PT_BR.zoneDetail.docTitleLabel}
                </label>
                <input
                  type="text"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  placeholder={PT_BR.zoneDetail.docTitlePlaceholder}
                  className="imx-input text-sm"
                />
              </div>

              <div className="md:col-span-3">
                <button
                  type="submit"
                  disabled={uploading || selectedFiles.length === 0 || !userEmail}
                  className="imx-glass-button imx-button-primary w-full"
                >
                  <CloudArrowUp size={18} weight="bold" />
                  <span>
                    {uploading ? PT_BR.zoneDetail.uploadingButton : PT_BR.zoneDetail.uploadButton}
                  </span>
                </button>
              </div>
            </form>

            {selectedFiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-4">
                {selectedFiles.map((file) => (
                  <span
                    key={file.name}
                    className="imx-badge imx-badge-darkblue text-xs normal-case"
                  >
                    <FilePdf size={14} weight="bold" />
                    <span>
                      {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                    </span>
                  </span>
                ))}
              </div>
            )}

            {uploadError && (
              <div className="mt-4 p-3 rounded-xl border border-[var(--imx-accent-danger)] bg-[var(--imx-accent-danger-soft)] flex items-center gap-2 text-sm">
                <WarningCircle
                  size={18}
                  weight="regular"
                  style={{ color: 'var(--imx-accent-danger)', flexShrink: 0 }}
                />
                <span style={{ color: 'var(--imx-accent-danger)' }}>{uploadError}</span>
              </div>
            )}
          </div>
        )}

        {/* etapa 2: processamento e extração de conteúdo */}
        {activeStep === 2 && (
          <div className="imx-glass-card">
            <span className="imx-badge imx-badge-warm mb-2">Etapa 02</span>
            <h2
              className="imx-heading text-xl font-extrabold m-0 mb-1"
              style={{ color: 'var(--imx-text-title)' }}
            >
              {PT_BR.zoneDetail.processingSectionTitle}
            </h2>
            <p className="text-sm mb-5" style={{ color: 'var(--imx-text-muted)' }}>
              {PT_BR.zoneDetail.processingSectionSubtitle}
            </p>

            <div className="p-4 rounded-xl border border-[var(--imx-border-solid)] bg-[var(--imx-bg-elevated)]">
              <div className="flex items-center justify-between text-xs font-bold imx-display-font mb-2">
                <span>{jobStageText ?? PT_BR.zoneDetail.jobStages.queued}</span>
                <span>{jobProgress ?? 0}%</span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden border border-[var(--imx-border-solid)] bg-[var(--imx-bg-canvas)]">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.max(5, Math.min(100, jobProgress ?? 8))}%`,
                    background:
                      (jobProgress ?? 0) >= 100
                        ? 'var(--imx-accent-darkblue)'
                        : 'var(--imx-accent-warm)',
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* etapa 3: revisão do study pack e curadoria completa das 4 categorias */}
        {activeStep === 3 && (
          <div className="imx-glass-card flex flex-col gap-5">
            {!pack ? (
              <div className="py-8 text-center flex flex-col items-center gap-3">
                <LockSimple size={32} weight="regular" />
                <h2
                  className="imx-heading text-xl font-extrabold m-0"
                  style={{ color: 'var(--imx-text-title)' }}
                >
                  {PT_BR.zoneDetail.reviewEmptyTitle}
                </h2>
                <p className="text-sm max-w-md m-0" style={{ color: 'var(--imx-text-muted)' }}>
                  {PT_BR.zoneDetail.reviewEmptySubtitle}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveStep(1)}
                  className="imx-glass-button imx-button-primary mt-2"
                >
                  <span>{PT_BR.zoneDetail.goToStep1Button}</span>
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="imx-badge imx-badge-darkblue mb-2">Etapa 03</span>
                    <h2
                      className="imx-heading text-xl font-extrabold m-0"
                      style={{ color: 'var(--imx-text-title)' }}
                    >
                      {PT_BR.zoneDetail.reviewSectionTitle}
                    </h2>
                    <p className="text-sm m-0 mt-1" style={{ color: 'var(--imx-text-muted)' }}>
                      {PT_BR.zoneDetail.reviewSectionSubtitle}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setActiveStep(1)}
                      className="imx-glass-button text-xs py-2 px-3.5"
                    >
                      <CloudArrowUp size={16} weight="bold" />
                      <span>Adicionar outro PDF</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveStep(4)}
                      className="imx-glass-button imx-button-primary text-xs py-2 px-4"
                    >
                      <span>{PT_BR.zoneDetail.proceedToStep4Button}</span>
                      <ArrowRight size={15} weight="bold" />
                    </button>
                  </div>
                </div>

                {/* métricas e barra de filtros por categoria */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setCategoryFilter('all')}
                    className={`imx-glass-card text-left p-3 cursor-pointer ${
                      categoryFilter === 'all' ? 'ring-2 ring-[var(--imx-border-solid)]' : ''
                    }`}
                  >
                    <div className="text-xs font-bold uppercase imx-display-font opacity-75">
                      {PT_BR.zoneDetail.filters.all}
                    </div>
                    <div className="text-2xl font-extrabold imx-heading mt-0.5">
                      {pack.concepts.length +
                        pack.cards.length +
                        pack.quiz.length +
                        pack.assets.length}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategoryFilter('concepts')}
                    className={`imx-glass-card text-left p-3 cursor-pointer ${
                      categoryFilter === 'concepts'
                        ? 'ring-2 ring-[var(--imx-accent-darkblue)]'
                        : ''
                    }`}
                    style={{ borderLeft: '4px solid var(--imx-accent-darkblue)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase imx-display-font">
                        {PT_BR.zoneDetail.statsConcepts}
                      </span>
                      <Brain
                        size={18}
                        weight="bold"
                        style={{ color: 'var(--imx-accent-darkblue)' }}
                      />
                    </div>
                    <div className="text-2xl font-extrabold imx-heading mt-0.5">
                      {pack.concepts.length}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategoryFilter('flashcards')}
                    className={`imx-glass-card text-left p-3 cursor-pointer ${
                      categoryFilter === 'flashcards'
                        ? 'ring-2 ring-[var(--imx-accent-lightblue)]'
                        : ''
                    }`}
                    style={{ borderLeft: '4px solid var(--imx-accent-lightblue)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase imx-display-font">
                        {PT_BR.zoneDetail.statsCards}
                      </span>
                      <Cards
                        size={18}
                        weight="bold"
                        style={{ color: 'var(--imx-accent-lightblue)' }}
                      />
                    </div>
                    <div className="text-2xl font-extrabold imx-heading mt-0.5">
                      {pack.cards.length}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategoryFilter('quiz')}
                    className={`imx-glass-card text-left p-3 cursor-pointer ${
                      categoryFilter === 'quiz' ? 'ring-2 ring-[var(--imx-accent-warm)]' : ''
                    }`}
                    style={{ borderLeft: '4px solid var(--imx-accent-warm)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase imx-display-font">
                        {PT_BR.zoneDetail.statsQuiz}
                      </span>
                      <Exam size={18} weight="bold" style={{ color: 'var(--imx-accent-warm)' }} />
                    </div>
                    <div className="text-2xl font-extrabold imx-heading mt-0.5">
                      {pack.quiz.length}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCategoryFilter('studyObjects')}
                    className={`imx-glass-card text-left p-3 cursor-pointer ${
                      categoryFilter === 'studyObjects'
                        ? 'ring-2 ring-[var(--imx-accent-darkblue)]'
                        : ''
                    }`}
                    style={{ borderLeft: '4px solid var(--imx-accent-darkblue)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase imx-display-font">
                        {PT_BR.zoneDetail.statsAssets}
                      </span>
                      <Cube
                        size={18}
                        weight="bold"
                        style={{ color: 'var(--imx-accent-darkblue)' }}
                      />
                    </div>
                    <div className="text-2xl font-extrabold imx-heading mt-0.5">
                      {pack.assets.length}
                    </div>
                  </button>
                </div>

                {/* grade unificada das 4 categorias com diferenciação por cor e ícone phosphor */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* 1. CONCEITOS (azul escuro + ícone Brain + edição/remoção) */}
                  {showConcepts &&
                    pack.concepts.map((concept) => {
                      const isEditing = editingConceptId === concept.id;
                      const firstPage = concept.anchors[0]?.page ?? 1;

                      return (
                        <div
                          key={`concept-${concept.id}`}
                          className="imx-glass-card flex flex-col justify-between gap-3"
                          style={{ borderLeft: '4px solid var(--imx-accent-darkblue)' }}
                        >
                          {isEditing ? (
                            <div className="flex flex-col gap-2">
                              <input
                                type="text"
                                maxLength={40}
                                value={draftLabel}
                                onChange={(e) => setDraftLabel(e.target.value)}
                                placeholder={PT_BR.zoneDetail.conceptLabelInput}
                                className="imx-input text-sm font-bold"
                              />
                              <textarea
                                rows={2}
                                maxLength={280}
                                value={draftDef}
                                onChange={(e) => setDraftDef(e.target.value)}
                                placeholder={PT_BR.zoneDetail.conceptDefInput}
                                className="imx-input text-xs"
                              />
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => void handleCommitEditConcept(concept.id)}
                                  className="imx-glass-button imx-button-primary text-xs py-1.5 px-3"
                                >
                                  <Check size={14} weight="bold" />
                                  <span>{PT_BR.zoneDetail.saveConceptButton}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingConceptId(null)}
                                  className="imx-glass-button text-xs py-1.5 px-3"
                                >
                                  <X size={14} weight="bold" />
                                  <span>{PT_BR.zoneDetail.cancelEditButton}</span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                  <span className="imx-badge imx-badge-darkblue">
                                    <Brain size={13} weight="bold" />
                                    <span>{PT_BR.zoneDetail.categories.concept}</span>
                                  </span>
                                  <span className="imx-badge text-[11px] py-0.5 px-2">
                                    pág. {firstPage}
                                  </span>
                                </div>
                                <h3
                                  className="font-bold text-base imx-heading m-0 mb-1"
                                  style={{ color: 'var(--imx-text-title)' }}
                                >
                                  {concept.label}
                                </h3>
                                <p
                                  className="text-xs m-0 leading-relaxed"
                                  style={{ color: 'var(--imx-text-muted)' }}
                                >
                                  {concept.definition}
                                </p>
                              </div>

                              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--imx-border-subtle)]">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleStartEditConcept(
                                      concept.id,
                                      concept.label,
                                      concept.definition,
                                    )
                                  }
                                  className="imx-glass-button text-xs py-1 px-2.5"
                                >
                                  <PencilSimple size={14} weight="regular" />
                                  <span>{PT_BR.zoneDetail.editConceptButton}</span>
                                </button>

                                <button
                                  type="button"
                                  disabled={pack.concepts.length <= 1}
                                  onClick={() => void handleRemoveConcept(concept.id)}
                                  className="imx-glass-button imx-button-danger text-xs py-1 px-2.5"
                                >
                                  <Trash size={14} weight="regular" />
                                  <span>{PT_BR.zoneDetail.removeConceptButton}</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}

                  {/* 2. FLASHCARDS (azul claro elétrico + ícone Cards) */}
                  {showFlashcards &&
                    pack.cards.map((card) => {
                      const firstPage = card.anchors[0]?.page ?? 1;
                      return (
                        <div
                          key={`card-${card.id}`}
                          className="imx-glass-card flex flex-col justify-between gap-2.5"
                          style={{ borderLeft: '4px solid var(--imx-accent-lightblue)' }}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="imx-badge imx-badge-lightblue">
                                <Cards size={13} weight="bold" />
                                <span>{PT_BR.zoneDetail.categories.flashcard}</span>
                              </span>
                              <span className="imx-badge text-[11px] py-0.5 px-2">
                                pág. {firstPage}
                              </span>
                            </div>
                            <h3
                              className="font-bold text-base imx-heading m-0 mb-1"
                              style={{ color: 'var(--imx-text-title)' }}
                            >
                              {card.title}
                            </h3>
                            <p
                              className="text-xs m-0 leading-relaxed"
                              style={{ color: 'var(--imx-text-muted)' }}
                            >
                              {card.body}
                            </p>
                          </div>
                        </div>
                      );
                    })}

                  {/* 3. QUIZ (amarelo-laranja + ícone Exam) */}
                  {showQuiz &&
                    pack.quiz.map((item) => {
                      const firstPage = item.anchors[0]?.page ?? 1;
                      return (
                        <div
                          key={`quiz-${item.id}`}
                          className="imx-glass-card flex flex-col justify-between gap-2.5"
                          style={{ borderLeft: '4px solid var(--imx-accent-warm)' }}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="imx-badge imx-badge-warm">
                                <Exam size={13} weight="bold" />
                                <span>{PT_BR.zoneDetail.categories.quiz}</span>
                              </span>
                              <div className="flex items-center gap-2.5">
                                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] select-none text-[var(--imx-text-muted)]">
                                  <input
                                    type="checkbox"
                                    checked={item.answered ?? false}
                                    onChange={(e) =>
                                      void handleToggleQuizAnswered(item.id, e.target.checked)
                                    }
                                    className="rounded border-[var(--imx-border-line)] accent-[var(--imx-accent-warm)] cursor-pointer"
                                  />
                                  <span>Respondida</span>
                                </label>
                                <span className="imx-badge text-[11px] py-0.5 px-2">
                                  pág. {firstPage}
                                </span>
                              </div>
                            </div>
                            <h3
                              className="font-bold text-sm imx-heading m-0 mb-2"
                              style={{ color: 'var(--imx-text-title)' }}
                            >
                              {item.prompt}
                            </h3>
                            <ul className="m-0 pl-4 text-xs flex flex-col gap-1">
                              {item.options.map((opt, optIdx) => (
                                <li
                                  key={`${item.id}-opt-${optIdx}`}
                                  style={{
                                    color:
                                      optIdx === item.correctIndex
                                        ? 'var(--imx-accent-warm)'
                                        : 'var(--imx-text-muted)',
                                    fontWeight: optIdx === item.correctIndex ? 700 : 400,
                                  }}
                                >
                                  {opt}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      );
                    })}

                  {/* 4. OBJETOS DE ESTUDO (azul escuro/ciano + ícone Cube) */}
                  {showStudyObjects &&
                    pack.assets.map((asset) => {
                      const typeLabel =
                        asset.kind === 'concept-graph'
                          ? PT_BR.zoneDetail.categories.studyObjectGraph
                          : PT_BR.zoneDetail.categories.studyObjectSequence;
                      return (
                        <div
                          key={`asset-${asset.id}`}
                          className="imx-glass-card flex flex-col justify-between gap-2.5"
                          style={{ borderLeft: '4px solid var(--imx-accent-darkblue)' }}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="imx-badge imx-badge-darkblue">
                                <Cube size={13} weight="bold" />
                                <span>{PT_BR.zoneDetail.categories.studyObject}</span>
                              </span>
                              <span className="imx-badge text-[11px] py-0.5 px-2">{typeLabel}</span>
                            </div>
                            <h3
                              className="font-bold text-base imx-heading m-0 mb-1"
                              style={{ color: 'var(--imx-text-title)' }}
                            >
                              {asset.title}
                            </h3>
                            <p
                              className="text-xs m-0 leading-relaxed"
                              style={{ color: 'var(--imx-text-muted)' }}
                            >
                              {asset.whySpatial}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        )}

        {/* etapa 4: entrar na zona vr */}
        {activeStep === 4 && zone && (
          <div
            className="imx-glass-card flex flex-wrap items-center justify-between gap-5"
            style={{ borderLeft: '4px solid var(--imx-accent-warm)' }}
          >
            <div className="max-w-xl">
              <span className="imx-badge imx-badge-warm mb-2">Etapa 04</span>
              <h2
                className="imx-heading text-xl font-extrabold m-0"
                style={{ color: 'var(--imx-text-title)' }}
              >
                {PT_BR.zoneDetail.enterZoneCtaTitle}
              </h2>
              <p className="text-sm m-0 mt-1.5" style={{ color: 'var(--imx-text-muted)' }}>
                {PT_BR.zoneDetail.enterZoneCtaSubtitle}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveStep(3)}
                className="imx-glass-button text-xs py-2.5 px-4"
              >
                <ArrowLeft size={15} weight="bold" />
                <span>Voltar para Revisão</span>
              </button>
              <button
                type="button"
                onClick={() => onRequestEnterZone(zone)}
                className="imx-glass-button imx-button-accent text-sm py-3 px-6"
              >
                <Goggles size={20} weight="bold" />
                <span>{PT_BR.zoneDetail.enterZoneButton}</span>
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
