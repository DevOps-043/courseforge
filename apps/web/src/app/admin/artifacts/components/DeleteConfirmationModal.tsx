import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { EngineDialog } from "@/components/ui/EngineDialog";

interface DeleteConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  artifactTitle: string;
  isDeleting: boolean;
}

export function DeleteConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  artifactTitle,
  isDeleting,
}: DeleteConfirmationModalProps) {
  return (
    <EngineDialog
      isOpen={isOpen}
      onClose={() => { if (!isDeleting) onClose(); }}
      size="compact"
      eyebrow="Acción irreversible"
      title="Eliminar artefacto"
      description="Confirma el recurso que se eliminará del espacio de trabajo."
      icon={<AlertTriangle />}
      footer={(
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="min-h-11 rounded-[0.86rem] border border-[var(--engine-border)] bg-[var(--engine-surface-soft)] px-4 text-sm font-medium text-[var(--engine-text-muted)] hover:text-[var(--engine-text)] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex min-h-11 items-center justify-center gap-2 rounded-[0.86rem] border border-red-500 bg-red-500 px-4 text-sm font-medium text-white shadow-lg hover:-translate-y-px hover:bg-red-600 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
            {isDeleting ? "Eliminando..." : "Eliminar artefacto"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm leading-6 text-[var(--engine-text-muted)]">
          Se eliminarán permanentemente el artefacto y todos sus datos asociados.
        </p>
        <div className="rounded-2xl border border-[var(--engine-border)] bg-[var(--engine-surface-soft)] p-4">
          <p className="mb-1 font-[var(--font-system-label)] text-[0.56rem] font-semibold uppercase tracking-[0.11em] text-[var(--engine-text-muted)]">Artefacto seleccionado</p>
          <p className="line-clamp-3 text-sm font-medium text-[var(--engine-text)]">{artifactTitle}</p>
        </div>
        <p className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-3 text-xs leading-5 text-red-500">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          Esta acción no se puede deshacer.
        </p>
      </div>
    </EngineDialog>
  );
}
