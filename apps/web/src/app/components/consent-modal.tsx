import { Check, ShieldCheck, Trash, WarningCircle, X } from '@phosphor-icons/react';
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
    // mantém o histórico local ativo para retomar sessões de estudo no dispositivo
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
      style={{ background: 'rgba(18, 19, 22, 0.78)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
    >
      <div className="imx-glass-panel max-w-2xl w-full max-h-[92vh] overflow-y-auto relative">
        <div className="imx-panel-header">
          <span className="imx-badge imx-badge-darkblue">
            <ShieldCheck size={16} weight="regular" />
            <span>Privacidade</span>
          </span>
          <button
            type="button"
            className="imx-glass-button py-1.5 px-2.5"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <h2 className="imx-title text-2xl">{PT_BR.consent.modalTitle}</h2>
        <p className="imx-subtitle text-sm mb-5">{PT_BR.consent.modalSubtitle}</p>

        <div className="flex flex-col gap-3 mb-6">
          <label className="imx-glass-card flex items-start gap-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={telemetryLocal}
              onChange={(e) => setTelemetryLocal(e.target.checked || true)}
              className="mt-1 w-4 h-4 accent-[#1e3a8a]"
            />
            <div className="flex-1">
              <div className="font-bold text-sm mb-1" style={{ color: 'var(--imx-text-title)' }}>
                {PT_BR.consent.telemetryLocalTitle}
              </div>
              <p className="text-xs m-0 leading-relaxed" style={{ color: 'var(--imx-text-muted)' }}>
                {PT_BR.consent.telemetryLocalDesc}
              </p>
            </div>
          </label>

          <label className="imx-glass-card flex items-start gap-3.5 cursor-pointer">
            <input
              type="checkbox"
              checked={research}
              onChange={(e) => setResearch(e.target.checked)}
              className="mt-1 w-4 h-4 accent-[#1e3a8a]"
            />
            <div className="flex-1">
              <div className="font-bold text-sm mb-1" style={{ color: 'var(--imx-text-title)' }}>
                {PT_BR.consent.researchTitle}
              </div>
              <p className="text-xs m-0 leading-relaxed" style={{ color: 'var(--imx-text-muted)' }}>
                {PT_BR.consent.researchDesc}
              </p>
            </div>
          </label>
        </div>

        {deletedBanner && (
          <div className="imx-badge imx-badge-warm w-full justify-center py-2.5 mb-4">
            <WarningCircle size={16} weight="bold" />
            <span>{PT_BR.consent.deleteMyDataDone}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--imx-border-subtle)]">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleDeleteClick()}
            className="imx-glass-button imx-button-danger text-xs"
          >
            <Trash size={16} weight="regular" />
            <span>
              {confirmDelete ? PT_BR.consent.deleteMyDataConfirm : PT_BR.consent.deleteMyDataButton}
            </span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleConfirm()}
            className="imx-glass-button imx-button-primary text-xs"
          >
            <Check size={16} weight="bold" />
            <span>{PT_BR.consent.confirmAndProceed}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
