'use client';

import { AlertTriangle, RefreshCw, Check } from 'lucide-react';
import { useState } from 'react';

interface UpstreamChangeAlertProps {
    source: string; // e.g. "Temario" or "Plan Instruccional"
    onIterate: () => void;
    onDismiss: () => void;
    isIterating?: boolean;
}

export function UpstreamChangeAlert({ source, onIterate, onDismiss, isIterating = false }: UpstreamChangeAlertProps) {
    const [dismissed, setDismissed] = useState(false);

    if (dismissed) return null;

    return (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-600/40 bg-amber-50 dark:bg-amber-900/15 flex flex-col sm:flex-row items-start sm:items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-800/30 text-amber-600 dark:text-amber-400 shrink-0">
                    <AlertTriangle size={18} />
                </div>
                <div>
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                        Se detectaron cambios en un paso anterior
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400/80 mt-0.5">
                        El contenido de <span className="font-semibold">{source}</span> fue modificado después de generar este paso. Es posible que el contenido actual no refleje los cambios más recientes.
                    </p>
                </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-auto">
                <button
                    onClick={onIterate}
                    disabled={isIterating}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500 rounded-lg transition-colors disabled:opacity-50"
                >
                    {isIterating ? <RefreshCw size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    Iterar
                </button>
                <button
                    onClick={() => {
                        setDismissed(true);
                        onDismiss();
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 bg-white dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 hover:bg-amber-50 dark:hover:bg-amber-900/50 rounded-lg transition-colors"
                >
                    <Check size={13} />
                    Mantener
                </button>
            </div>
        </div>
    );
}
