"use client";

import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Trash2 } from "lucide-react";

interface ArtifactDropdownMenuProps {
  isOpen: boolean;
  onClose: () => void;
  onDelete: () => void;
  anchor: DOMRect | null;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 5;

export function ArtifactDropdownMenu({
  isOpen,
  onClose,
  onDelete,
  anchor,
}: ArtifactDropdownMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!isOpen || !anchor || !menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const preferredTop = anchor.bottom + ANCHOR_GAP;
    const top = preferredTop + height <= window.innerHeight - VIEWPORT_MARGIN
      ? preferredTop
      : anchor.top - height - ANCHOR_GAP;
    menu.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN))}px`;
    menu.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - width, window.innerWidth - width - VIEWPORT_MARGIN))}px`;
    deleteButtonRef.current?.focus({ preventScroll: true });
  }, [anchor, isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <button type="button" tabIndex={-1} aria-label="Cerrar menú de acciones" className="fixed inset-0 z-[1000003] cursor-default bg-transparent" onClick={onClose} />

      <div
        ref={menuRef}
        role="menu"
        aria-label="Acciones del artefacto"
        className="engine-floating-menu"
        style={{ animation: "none", maxHeight: "calc(100vh - 16px)", overflowY: "auto" }}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Tab") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
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
            onClose();
            onDelete();
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
