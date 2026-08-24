'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import styles from './EngineDialog.module.css';

interface EngineDialogProps {
  bodyClassName?: string;
  children: ReactNode;
  closeDisabled?: boolean;
  description?: string;
  eyebrow?: string;
  footer?: ReactNode;
  icon: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  size?: 'compact' | 'standard' | 'wide' | 'workspace';
  title: string;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function EngineDialog({
  bodyClassName,
  children,
  closeDisabled = false,
  description,
  eyebrow = 'SofLIA Engine',
  footer,
  icon,
  isOpen,
  onClose,
  size = 'standard',
  title,
}: EngineDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusFirstControl = window.setTimeout(() => {
      const firstControl = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      firstControl?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!closeDisabled) onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusFirstControl);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [closeDisabled, isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const sizeClass = size === 'workspace'
    ? styles.workspace
    : size === 'wide'
      ? styles.wide
      : size === 'compact'
        ? styles.compact
        : '';

  return createPortal(
    <motion.div
      className={styles.overlay}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose();
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`${styles.dialog} ${sizeClass}`}
        initial={{ opacity: 0, y: 18, scale: 0.975 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.985 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className={styles.header}>
          <span className={styles.icon} aria-hidden="true">{icon}</span>
          <div className={styles.heading}>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id={titleId} className={styles.title}>{title}</h2>
            {description && <p id={descriptionId} className={styles.description}>{description}</p>}
          </div>
          <button type="button" className={styles.close} onClick={onClose} disabled={closeDisabled} aria-label="Cerrar modal">
            <X />
          </button>
        </header>
        <div className={`${styles.body} ${bodyClassName || ''}`}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </motion.div>
    </motion.div>,
    document.body,
  );
}
