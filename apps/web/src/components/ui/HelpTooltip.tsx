'use client';

import { useId, type ReactNode } from 'react';

type HelpTooltipProps = {
    align?: 'center' | 'end' | 'start';
    ariaLabel: string;
    children: ReactNode;
    stopPropagation?: boolean;
};

/** Patrón compartido de ayuda para controles y campos de formulario. */
const TOOLTIP_ALIGNMENT_CLASSES = {
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
    start: 'left-0',
} as const;

export function HelpTooltip({ align = 'center', ariaLabel, children, stopPropagation = false }: HelpTooltipProps) {
    const tooltipId = useId();
    return (
        <span className="group relative inline-flex">
            <button
                type="button"
                aria-label={ariaLabel}
                aria-describedby={tooltipId}
                onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
                onKeyDown={stopPropagation ? (event) => event.stopPropagation() : undefined}
                className="h-5 w-5 rounded-full border border-gray-300 text-[11px] font-bold text-gray-500 transition-colors hover:border-[var(--engine-accent)] hover:text-[var(--engine-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--engine-accent)]/30 dark:border-[var(--engine-muted)]/40 dark:text-[var(--engine-text-muted)]"
            >
                ?
            </button>
            <span
                role="tooltip"
                id={tooltipId}
                className={`pointer-events-none absolute top-7 z-50 hidden w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 !bg-white p-3 text-left text-xs font-normal normal-case tracking-normal leading-relaxed text-gray-600 shadow-xl shadow-black/20 group-hover:block group-focus-within:block dark:border-[var(--engine-muted)]/40 dark:!bg-[#1c2329] dark:text-gray-200 ${TOOLTIP_ALIGNMENT_CLASSES[align]}`}
            >
                {children}
            </span>
        </span>
    );
}
