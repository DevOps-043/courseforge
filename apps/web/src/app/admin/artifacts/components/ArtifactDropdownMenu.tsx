import { Trash2 } from "lucide-react";

interface ArtifactDropdownMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onDelete: () => void;
  position: { x: number; y: number };
}

export function ArtifactDropdownMenu({
  isOpen,
  onClose,
  onDelete,
  position,
}: ArtifactDropdownMenuProps) {
  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        className="fixed z-50 bg-white dark:bg-[#1E2329] rounded-xl shadow-xl border border-gray-200 dark:border-[#6C757D]/20 py-1.5 min-w-[160px] animate-in fade-in slide-in-from-top-2 duration-150"
        style={{
          top: position.y,
          left: position.x,
          transform: "translateX(-100%)",
        }}
      >
        <button
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
            onClose();
          }}
          className="w-full px-4 py-2.5 text-left text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-3 transition-colors"
        >
          <Trash2 size={16} />
          Eliminar artefacto
        </button>
      </div>
    </>
  );
}
