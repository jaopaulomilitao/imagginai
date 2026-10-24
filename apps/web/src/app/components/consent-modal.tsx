import { CheckCircle, ShieldCheck, Trash, WarningCircle, X } from '@phosphor-icons/react';
import { useState } from 'react';

import { PT_BR } from '../../shared/i18n/pt-br';
import type { StoredUserConsent } from '../../shared/storage/dexie-db';

export interface ConsentModalProps {
  readonly open: boolean;
  readonly initialConsent: StoredUserConsent | null;
  readonly onSave: (consent: { telemetryLocal: boolean; research: boolean }) => Promise<void>;
  readonly onDeleteAllData: () => Promise<void>;
  readonly onClose: () => void;
}

export function ConsentModal({
  open,
  initialConsent,
  onSave,
  onDeleteAllData,
  onClose,
}: ConsentModalProps) {
  const [telemetryLocal, setTelemetryLocal] = useState<boolean>(
    initialConsent?.telemetryLocal ?? true,
  );
  const [research, setResearch] = useState<boolean>(initialConsent?.research ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletedBanner, setDeletedBanner] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleConfirm = async () => {
    // garante que a telemetria local mínima esteja ativa para métricas pessoais na zona
    setSaving(true);
    try {
      await onSave({ telemetryLocal: true, research });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await onDeleteAllData();
      setConfirmDelete(false);
      setDeletedBanner(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(5, 7, 11, 0.82)', backdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
    >
      <div className="imx-glass-panel max-w-2xl w-full relative">
        <div className="imx-panel-header">
          <span className="imx-badge imx-badge-blue">
            <ShieldCheck size={18} weight="duotone" />
            <span>LGPD • Seção 3.9</span>
          </span>
          <button type="button" className="imx-glass-button py-1.5 px-2.5" onClick={onClose}>
            <X size={18} weight="bold" />
          </button>
        </div>

        <h2 className="imx-title text-2xl">{PT_BR.consent.modalTitle}</h2>
        <p className="imx-subtitle text-sm mb-5">{PT_BR.consent.modalSubtitle}</p>

        <div className="flex flex-col gap-3.5 mb-6">
          <label className="imx-glass-card flex items-start gap-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={telemetryLocal}
              onChange={(e) => setTelemetryLocal(e.target.checked || true)}
              className="mt-1 w-5 h-5 accent-[#2563eb]"
            />
            <div className="flex-1">
              <div className="font-bold text-base mb-1" style={{ color: 'var(--imx-text-title)' }}>
                {PT_BR.consent.telemetryLocalTitle}
              </div>
              <p className="text-sm m-0" style={{ color: 'var(--imx-text-muted)' }}>
                {PT_BR.consent.telemetryLocalDesc}
              </p>
            </div>
          </label>

          <label className="imx-glass-card flex items-start gap-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={research}
              onChange={(e) => setResearch(e.target.checked)}
              className="mt-1 w-5 h-5 accent-[#2563eb]"
            />
            <div className="flex-1">
              <div className="font-bold text-base mb-1" style={{ color: 'var(--imx-text-title)' }}>
                {PT_BR.consent.researchTitle}
              </div>
              <p className="text-sm m-0" style={{ color: 'var(--imx-text-muted)' }}>
                {PT_BR.consent.researchDesc}
              </p>
            </div>
          </label>
        </div>

        {deletedBanner && (
          <div className="imx-badge imx-badge-yellow w-full justify-center py-2.5 mb-4">
            <WarningCircle size={18} weight="bold" />
            <span>{PT_BR.consent.deleteMyDataDone}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--imx-glass-border-subtle)]">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleDeleteClick()}
            className="imx-glass-button imx-button-danger text-sm"
          >
            <Trash size={18} weight="duotone" />
            <span>
              {confirmDelete ? PT_BR.consent.deleteMyDataConfirm : PT_BR.consent.deleteMyDataButton}
            </span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleConfirm()}
            className="imx-glass-button imx-button-primary"
          >
            <CheckCircle size={20} weight="bold" />
            <span>{PT_BR.consent.confirmAndProceed}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
