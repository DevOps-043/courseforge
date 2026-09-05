'use client';

import { Library as LibraryIcon, Music2 } from 'lucide-react';
import { SoundEffectLibraryPanel } from './SoundEffectLibraryPanel';

/** The library is intentionally limited to reusable SFX, not opaque course-material records. */
export function LibraryPageClient() {
    return (
        <div className="space-y-6">
            <div className="engine-page-hero flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                    <p className="engine-eyebrow">Recursos de producción</p>
                    <h1 className="flex items-center gap-3 text-3xl">
                        <LibraryIcon aria-hidden="true" />
                        Biblioteca de efectos de sonido
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm">
                        Gestiona los efectos reutilizables de la empresa y añádelos a las composiciones desde el editor.
                    </p>
                </div>
                <span className="flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs text-white/80 backdrop-blur-sm">
                    <Music2 size={14} aria-hidden="true" />
                    SFX reutilizables
                </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-500 shadow-sm dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]">
                <span className="font-semibold text-gray-700 dark:text-gray-300">Empresa activa</span>
                <span>/</span>
                <span>Biblioteca</span>
                <span>/</span>
                <span>Efectos de sonido</span>
            </div>

            <SoundEffectLibraryPanel />
        </div>
    );
}
