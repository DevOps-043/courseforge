import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-white dark:bg-[#1E2329] rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl border border-gray-200 dark:border-[#6C757D]/20 animate-in fade-in zoom-in-95 duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors"
        >
          <X size={20} />
        </button>

        <div className="w-14 h-14 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="text-red-500" size={28} />
        </div>

        <h3 className="text-xl font-bold text-gray-900 dark:text-white text-center mb-2">
          Eliminar artefacto?
        </h3>

        <p className="text-gray-500 dark:text-[#94A3B8] text-center text-sm mb-2">
          Estas a punto de eliminar permanentemente:
        </p>
        <p className="text-gray-900 dark:text-white font-medium text-center text-sm bg-gray-50 dark:bg-[#151A21] rounded-lg py-2 px-3 mb-4 line-clamp-2">
          "{artifactTitle}"
        </p>
        <p className="text-red-500 dark:text-red-400 text-center text-xs mb-6">
          Esta accion no se puede deshacer. Se eliminaran todos los datos asociados.
        </p>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-[#6C757D]/30 text-gray-700 dark:text-[#94A3B8] font-medium text-sm hover:bg-gray-50 dark:hover:bg-[#151A21] transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isDeleting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Eliminando...
              </>
            ) : (
              <>
                <Trash2 size={16} />
                Eliminar
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
