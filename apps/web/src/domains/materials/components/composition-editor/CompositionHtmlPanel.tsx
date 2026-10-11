"use client";

import { ChevronDown, FilePenLine, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./CompositionHtmlPanel.module.css";

interface CompositionHtmlPanelProps {
  children: ReactNode;
  title: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  collapsible?: boolean;
  initiallyOpen?: boolean;
  busy?: boolean;
}

/** Presentation only: disclosure never loads data or authorizes an operation. */
export function CompositionHtmlPanel({ children, title, label, description, icon: Icon = FilePenLine,
  collapsible = false, initiallyOpen = false, busy = false }: CompositionHtmlPanelProps) {
  const heading = <>
    <span className={styles.icon}><Icon aria-hidden="true" size={17} strokeWidth={1.8} /></span>
    <h3 className={styles.title}>{title}</h3>
  </>;
  const content = <div className={styles.body}>
    {description && <p className={styles.description}>{description}</p>}
    {children}
  </div>;
  return <section className={styles.panel} aria-label={label} aria-busy={busy}>
    {collapsible ? <details className={styles.disclosure} open={initiallyOpen || undefined}>
      <summary className={styles.header}>{heading}<ChevronDown className={styles.chevron} aria-hidden="true" size={16} /></summary>
      {content}
    </details> : <><header className={styles.header}>{heading}</header>{content}</>}
  </section>;
}
