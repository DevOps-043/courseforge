'use client';

import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle, Info, Loader2 } from 'lucide-react';
import { EngineDialog } from '@/components/ui/EngineDialog';

export type ModalVariant = 'info' | 'success' | 'warning' | 'danger' | 'critical';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ModalVariant;
  isLoading?: boolean;
  hideActions?: boolean;
}

const variants = {
  info: { icon: Info, label: 'Confirmación', iconClass: 'text-[var(--engine-info)]', buttonClass: 'bg-[var(--engine-action)] text-[var(--engine-on-action)] hover:-translate-y-px' },
  success: { icon: CheckCircle, label: 'Acción completada', iconClass: 'text-[var(--engine-success)]', buttonClass: 'bg-[var(--engine-action)] text-[var(--engine-on-action)] hover:-translate-y-px' },
  warning: { icon: AlertTriangle, label: 'Revisión necesaria', iconClass: 'text-[var(--engine-warning)]', buttonClass: 'bg-amber-500 text-slate-950 hover:bg-amber-400 hover:-translate-y-px' },
  danger: { icon: AlertTriangle, label: 'Acción sensible', iconClass: 'text-[var(--engine-danger)]', buttonClass: 'bg-rose-600 text-white hover:bg-rose-500 hover:-translate-y-px' },
  critical: { icon: AlertOctagon, label: 'Acción irreversible', iconClass: 'text-[var(--engine-danger)]', buttonClass: 'bg-rose-700 text-white hover:bg-rose-600 hover:-translate-y-px' },
} as const;

const secondaryButton = 'min-h-11 rounded-xl border border-[var(--engine-border)] bg-[var(--engine-surface-soft)] px-4 text-sm font-semibold text-[var(--engine-text-muted)] transition-all hover:-translate-y-px hover:border-[var(--engine-border-active)] hover:text-[var(--engine-text)] disabled:cursor-not-allowed disabled:opacity-50';
const primaryButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50';

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  variant = 'info',
  isLoading = false,
  hideActions = false,
}: ConfirmationModalProps) {
  const style = variants[variant];
  const Icon = style.icon;

  return (
    <EngineDialog
      isOpen={isOpen}
      onClose={onClose}
      closeDisabled={isLoading}
      size="compact"
      eyebrow={style.label}
      title={title}
      icon={<Icon className={style.iconClass} aria-hidden="true" />}
      footer={hideActions ? undefined : (
        <>
          <button type="button" onClick={onClose} disabled={isLoading} className={secondaryButton}>
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm} disabled={isLoading} className={`${primaryButton} ${style.buttonClass}`}>
            {isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            {isLoading ? 'Procesando…' : confirmText}
          </button>
        </>
      )}
    >
      <div className="text-sm leading-6 text-[var(--engine-text-muted)]">{message}</div>
    </EngineDialog>
  );
}
