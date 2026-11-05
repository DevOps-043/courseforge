'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Edit } from 'lucide-react';
import type { PlatformUser } from './user-management.types';

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 5;

interface UserActionsMenuProps {
  anchor: DOMRect;
  user: PlatformUser;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onEdit: () => void;
}

export default function UserActionsMenu({ anchor, user, triggerRef, onClose, onEdit }: UserActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    const preferredTop = anchor.bottom + ANCHOR_GAP;
    const top = preferredTop + height <= window.innerHeight - VIEWPORT_MARGIN
      ? preferredTop
      : anchor.top - height - ANCHOR_GAP;
    menu.style.top = `${Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN))}px`;
    menu.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(anchor.right - width, window.innerWidth - width - VIEWPORT_MARGIN))}px`;
    editRef.current?.focus({ preventScroll: true });
  }, [anchor]);

  const closeAndRestoreFocus = () => {
    triggerRef.current?.focus({ preventScroll: true });
    onClose();
  };

  return createPortal(
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="Cerrar acciones de usuario"
        className="fixed inset-0 z-[1000003] bg-transparent cursor-default"
        onClick={closeAndRestoreFocus}
      />
      <div
        ref={menuRef}
        id="user-actions-menu"
        role="menu"
        aria-label={`Acciones de ${user.first_name || user.username || 'usuario'}`}
        className="engine-floating-menu"
        style={{ animation: 'none', maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' || event.key === 'Tab') {
            if (event.key === 'Escape') event.preventDefault();
            event.stopPropagation();
            closeAndRestoreFocus();
          } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            editRef.current?.focus();
          }
        }}
      >
        <div className="engine-floating-menu__header">Acciones · {user.first_name || user.username}</div>
        <button ref={editRef} type="button" role="menuitem" className="engine-floating-menu__item" onClick={() => {
          triggerRef.current?.focus({ preventScroll: true });
          onEdit();
        }}>
          <Edit size={14} aria-hidden="true" />
          Ver / Editar Rol
        </button>
      </div>
    </>,
    document.body,
  );
}
