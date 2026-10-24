import {
  ArrowLeft,
  Brain,
  Cards,
  CheckCircle,
  CloudArrowUp,
  CubeTransparent,
  Exam,
  FilePdf,
  FloppyDisk,
  Goggles,
  PencilSimple,
  Sparkle,
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
import type { EnvironmentPreset, ZoneTheme } from '../../zone/config/constants';
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
  const [environment, setEnvironment] = useState<EnvironmentPreset>('focus-dark');
  const [settingsSaved, setSettingsSaved] = useState(false);

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
        setEnvironment(loadedZone.environment);
      }
      if (loadedPack) {
        setPack(loadedPack);
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
      environment,
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
        // mantém a atualização local no dexie caso a API esteja offline
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
    setJobProgress(5);
    setJobStageText(PT_BR.zoneDetail.jobStages.queued);

    try {
      // garante que exista uma zona correspondente no backend caso o id atual seja local/demo
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

        // salva os bytes do pdf no indexeddb (dexie) para leitura 100% offline na zona 3d
        const buffer = await file.arrayBuffer();
        const effectiveTitle =
          selectedFiles.length === 1 && docTitle.trim()
            ? docTitle.trim()
            : file.name.replace(/\.pdf$/i, '');
        await zoneStorage.savePdfFile({
          zoneId: zone.id,
          sourceId: `local-${Date.now()}-${idx}`,
          title: effectiveTitle,
          data: new Uint8Array(buffer),
          savedAt: new Date().toISOString(),
        });

        const uploadRes = await uploadZoneSourcePdf(remoteZoneId, file, effectiveTitle);

        // acompanha o progresso do job em background até concluir ou falhar
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
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setUploadError(`${PT_BR.zoneDetail.jobStages.failed} ${msg}`);
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="imx-glass-button text-sm py-2 px-3.5">
            <ArrowLeft size={18} weight="bold" />
            <span>{PT_BR.zoneDetail.backToZones}</span>
          </Link>

          {zone && (
            <button
              type="button"
              onClick={() => onRequestEnterZone(zone)}
              className="imx-glass-button imx-button-primary"
            >
              <Goggles size={22} weight="duotone" />
              <span>{PT_BR.zoneDetail.enterZoneButton}</span>
            </button>
          )}
        </div>

        {/* configurações de nome e ambiente da zona */}
        {zone && (
          <form
            onSubmit={(e) => void handleSaveSettings(e)}
            className="imx-glass-card flex flex-wrap items-end gap-4"
          >
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5">
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

            <div className="w-full sm:w-56">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5">
                {PT_BR.home.environmentLabel}
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as EnvironmentPreset)}
                className="imx-input"
              >
                <option value="focus-dark">{PT_BR.zone.environmentLabels['focus-dark']}</option>
                <option value="focus-nature">{PT_BR.zone.environmentLabels['focus-nature']}</option>
              </select>
            </div>

            <button type="submit" className="imx-glass-button">
              <FloppyDisk size={19} weight="duotone" />
              <span>{PT_BR.zoneDetail.saveSettingsButton}</span>
            </button>

            {settingsSaved && (
              <span className="imx-badge imx-badge-blue py-2">
                <CheckCircle size={16} weight="bold" />
                <span>Salvo!</span>
              </span>
            )}
          </form>
        )}

        {/* seção 1: upload de pdf com barra de progresso do job */}
        <div className="imx-glass-card">
          <div className="flex items-center gap-2 mb-1">
            <FilePdf size={24} weight="duotone" style={{ color: 'var(--imx-accent-red)' }} />
            <h2
              className="imx-heading text-xl font-bold m-0"
              style={{ color: 'var(--imx-text-title)' }}
            >
              {PT_BR.zoneDetail.uploadSectionTitle}
            </h2>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--imx-text-muted)' }}>
            {PT_BR.zoneDetail.uploadSectionSubtitle}
          </p>

          {!userEmail && (
            <div className="imx-badge imx-badge-yellow w-full justify-start py-2.5 px-3.5 mb-4 text-xs normal-case">
              <WarningCircle size={18} weight="duotone" className="shrink-0" />
              <span>{PT_BR.zoneDetail.authRequiredNotice}</span>
            </div>
          )}

          <form
            onSubmit={(e) => void handleUploadPdf(e)}
            className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-end"
          >
            <div className="md:col-span-5">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5">
                {PT_BR.zoneDetail.selectPdfLabel} (1 ou mais arquivos)
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
              <label className="block text-xs font-bold uppercase tracking-wider mb-1.5">
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
                <CloudArrowUp size={20} weight="bold" />
                <span>
                  {uploading ? PT_BR.zoneDetail.uploadingButton : PT_BR.zoneDetail.uploadButton}
                </span>
              </button>
            </div>
          </form>

          {selectedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {selectedFiles.map((file) => (
                <span key={file.name} className="imx-badge imx-badge-blue text-xs normal-case">
                  <FilePdf size={14} weight="bold" />
                  <span>
                    {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)
                  </span>
                </span>
              ))}
            </div>
          )}

          {jobProgress !== null && (
            <div className="mt-4 pt-3 border-t border-[var(--imx-glass-border-subtle)]">
              <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                <span>{jobStageText}</span>
                <span>{jobProgress}%</span>
              </div>
              <div className="w-full h-3 rounded-full overflow-hidden bg-black/20">
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${Math.max(5, Math.min(100, jobProgress))}%`,
                    background:
                      jobProgress >= 100 ? 'var(--imx-accent-blue)' : 'var(--imx-accent-yellow)',
                  }}
                />
              </div>
            </div>
          )}

          {uploadError && (
            <div className="mt-3 p-3 rounded-xl border border-[var(--imx-accent-red)] bg-[var(--imx-accent-red-soft)] flex items-center gap-2 text-sm">
              <WarningCircle
                size={20}
                weight="duotone"
                style={{ color: 'var(--imx-accent-red)', flexShrink: 0 }}
              />
              <span style={{ color: 'var(--imx-accent-red)' }}>{uploadError}</span>
            </div>
          )}
        </div>

        {/* seção 2: revisão e curadoria de conceitos do study pack */}
        {pack && (
          <div className="imx-glass-card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <Sparkle size={24} weight="duotone" style={{ color: 'var(--imx-accent-yellow)' }} />
                <h2
                  className="imx-heading text-xl font-bold m-0"
                  style={{ color: 'var(--imx-text-title)' }}
                >
                  {PT_BR.zoneDetail.reviewSectionTitle}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="imx-badge imx-badge-blue">{pack.meta.model}</span>
                <span className="imx-badge imx-badge-yellow">
                  {PT_BR.zoneDetail.statsDiscarded(pack.meta.discarded)}
                </span>
              </div>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--imx-text-muted)' }}>
              {PT_BR.zoneDetail.reviewSectionSubtitle}
            </p>

            {/* métricas do pacote */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="imx-glass-card flex items-center gap-3 py-3">
                <Brain size={28} weight="duotone" style={{ color: 'var(--imx-accent-blue)' }} />
                <div>
                  <div className="text-2xl font-extrabold imx-heading">{pack.concepts.length}</div>
                  <div className="text-xs opacity-75">{PT_BR.zoneDetail.statsConcepts}</div>
                </div>
              </div>

              <div className="imx-glass-card flex items-center gap-3 py-3">
                <Cards size={28} weight="duotone" style={{ color: 'var(--imx-accent-yellow)' }} />
                <div>
                  <div className="text-2xl font-extrabold imx-heading">{pack.cards.length}</div>
                  <div className="text-xs opacity-75">{PT_BR.zoneDetail.statsCards}</div>
                </div>
              </div>

              <div className="imx-glass-card flex items-center gap-3 py-3">
                <Exam size={28} weight="duotone" style={{ color: 'var(--imx-accent-red)' }} />
                <div>
                  <div className="text-2xl font-extrabold imx-heading">{pack.quiz.length}</div>
                  <div className="text-xs opacity-75">{PT_BR.zoneDetail.statsQuiz}</div>
                </div>
              </div>

              <div className="imx-glass-card flex items-center gap-3 py-3">
                <CubeTransparent
                  size={28}
                  weight="duotone"
                  style={{ color: 'var(--imx-accent-blue)' }}
                />
                <div>
                  <div className="text-2xl font-extrabold imx-heading">{pack.assets.length}</div>
                  <div className="text-xs opacity-75">{PT_BR.zoneDetail.statsAssets}</div>
                </div>
              </div>
            </div>

            {/* lista de conceitos com renomeação e remoção */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pack.concepts.map((concept) => {
                const isEditing = editingConceptId === concept.id;
                const firstPage = concept.anchors[0]?.page ?? 1;

                return (
                  <div
                    key={concept.id}
                    className="imx-glass-card flex flex-col justify-between gap-2.5"
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
                            <CheckCircle size={16} weight="bold" />
                            <span>{PT_BR.zoneDetail.saveConceptButton}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingConceptId(null)}
                            className="imx-glass-button text-xs py-1.5 px-3"
                          >
                            <X size={16} weight="bold" />
                            <span>{PT_BR.zoneDetail.cancelEditButton}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span
                              className="font-bold text-base imx-heading"
                              style={{ color: 'var(--imx-text-title)' }}
                            >
                              {concept.label}
                            </span>
                            <span className="imx-badge text-[11px] py-0.5 px-2">
                              pág. {firstPage}
                            </span>
                          </div>
                          <p
                            className="text-xs m-0 leading-relaxed"
                            style={{ color: 'var(--imx-text-muted)' }}
                          >
                            {concept.definition}
                          </p>
                        </div>

                        <div className="flex items-center justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              handleStartEditConcept(concept.id, concept.label, concept.definition)
                            }
                            className="imx-glass-button text-xs py-1 px-2.5"
                          >
                            <PencilSimple size={15} weight="duotone" />
                            <span>{PT_BR.zoneDetail.editConceptButton}</span>
                          </button>

                          <button
                            type="button"
                            disabled={pack.concepts.length <= 1}
                            onClick={() => void handleRemoveConcept(concept.id)}
                            className="imx-glass-button imx-button-danger text-xs py-1 px-2.5"
                          >
                            <Trash size={15} weight="duotone" />
                            <span>{PT_BR.zoneDetail.removeConceptButton}</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* seção 3: handoff final para entrar na zona xr */}
        {zone && (
          <div className="imx-glass-card flex flex-wrap items-center justify-between gap-4 border-2 border-[var(--imx-accent-blue)]">
            <div>
              <h3
                className="imx-heading text-lg font-extrabold m-0"
                style={{ color: 'var(--imx-text-title)' }}
              >
                {PT_BR.zoneDetail.enterZoneCtaTitle}
              </h3>
              <p className="text-sm m-0 mt-1" style={{ color: 'var(--imx-text-muted)' }}>
                {PT_BR.zoneDetail.enterZoneCtaSubtitle}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onRequestEnterZone(zone)}
              className="imx-glass-button imx-button-primary text-base py-3 px-6"
            >
              <Goggles size={24} weight="duotone" />
              <span>{PT_BR.zoneDetail.enterZoneButton}</span>
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
