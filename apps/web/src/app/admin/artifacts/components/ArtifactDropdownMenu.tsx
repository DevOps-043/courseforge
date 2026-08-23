"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Trash2 } from "lucide-react";

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
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    deleteButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <button type="button" aria-label="Cerrar menú de acciones" className="fixed inset-0 z-[1000003] cursor-default bg-transparent" onClick={onClose} />

      <div
        role="menu"
        aria-label="Acciones del artefacto"
        className="engine-floating-menu"
        style={{
          top: position.y,
          left: position.x,
          transform: "translateX(-100%)",
        }}
      >
        <div className="engine-floating-menu__header">
          <MoreHorizontal size={14} />
          Acciones
        </div>
        <button
          ref={deleteButtonRef}
          type="button"
          role="menuitem"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
            onClose();
          }}
          className="engine-floating-menu__item engine-floating-menu__item--danger"
        >
          <Trash2 size={16} />
          Eliminar artefacto
        </button>
      </div>
    </>,
    document.body,
  );
}
