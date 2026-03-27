'use client';

import { useState } from 'react';
import { RefreshCw, AlertCircle, CheckSquare, Square } from 'lucide-react';

interface IterationPanelProps {
    currentIteration: number;
    maxIterations: number;
    /** Available component types for this lesson */
    availableComponents?: string[];
    onStartIteration: (instructions: string, componentTypes?: string[]) => void;
    className?: string;
}

const COMPONENT_LABELS: Record<string, string> = {
    DIALOGUE: 'Diálogo con SofLIA',
    READING: 'Lectura',
    QUIZ: 'Cuestionario',
    DEMO_GUIDE: 'Guía Demo',
    EXERCISE: 'Ejercicio',
    VIDEO_THEORETICAL: 'Video Teórico',
    VIDEO_DEMO: 'Video Demo',
    VIDEO_GUIDE: 'Video Guía',
};

export function IterationPanel({
    currentIteration,
    maxIterations,
    availableComponents = [],
    onStartIteration,
    className = '',
}: IterationPanelProps) {
    const [instructions, setInstructions] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
    const [selectAll, setSelectAll] = useState(true);

    const canIterate = currentIteration < maxIterations;
    const remainingIterations = maxIterations - currentIteration;

    const toggleComponent = (type: string) => {
        setSelectAll(false);
        setSelectedComponents(prev =>
            prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
        );
    };

    const handleSelectAll = () => {
        setSelectAll(true);
        setSelectedComponents([]);
    };

    const handleSubmit = async () => {
        if (!instructions.trim() || !canIterate) return;

        setIsSubmitting(true);
        try {
            // If selectAll or no specific selection, pass undefined (regenerate all)
            const types = selectAll || selectedComponents.length === 0
                ? undefined
                : selectedComponents;
            await onStartIteration(instructions, types);
            setInstructions('');
            setSelectedComponents([]);
            setSelectAll(true);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!canIterate) {
        return (
            <div className={`p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg ${className}`}>
                <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-red-800 dark:text-red-300">
                            Máximo de iteraciones alcanzado ({maxIterations})
                        </p>
                        <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                            Esta lección requiere revisión manual o debe registrarse un bloqueador.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`p-4 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg ${className}`}>
            <div className="flex items-center justify-between mb-3">
                <h5 className="text-sm font-medium text-orange-800 dark:text-orange-300">Iteración Dirigida</h5>
                <span className="text-xs text-orange-600 dark:text-orange-400">
                    {remainingIterations} intento{remainingIterations !== 1 ? 's' : ''} restante{remainingIterations !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Component Selector */}
            {availableComponents.length > 0 && (
                <div className="mb-3">
                    <p className="text-xs font-medium text-orange-700 dark:text-orange-400 mb-2">
                        ¿Qué componentes regenerar?
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {/* Select All chip */}
                        <button
                            type="button"
                            onClick={handleSelectAll}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                                selectAll
                                    ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                                    : 'bg-white dark:bg-[#1E2329] text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                            }`}
                        >
                            {selectAll ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                            Todos
                        </button>

                        {/* Individual component chips */}
                        {availableComponents.map(type => {
                            const isSelected = !selectAll && selectedComponents.includes(type);
                            return (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => toggleComponent(type)}
                                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                                        isSelected
                                            ? 'bg-orange-600 text-white border-orange-600 shadow-sm'
                                            : selectAll
                                                ? 'bg-orange-100/50 dark:bg-orange-900/10 text-orange-500 dark:text-orange-500 border-orange-200 dark:border-orange-800/50 opacity-60'
                                                : 'bg-white dark:bg-[#1E2329] text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-700 hover:bg-orange-100 dark:hover:bg-orange-900/30'
                                    }`}
                                >
                                    {isSelected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                                    {COMPONENT_LABELS[type] || type.replace(/_/g, ' ')}
                                </button>
                            );
                        })}
                    </div>

                    {!selectAll && selectedComponents.length > 0 && (
                        <p className="text-[11px] text-orange-600 dark:text-orange-500 mt-1.5">
                            Solo se regenerarán los componentes seleccionados. Los demás se mantendrán intactos.
                        </p>
                    )}
                </div>
            )}

            <p className="text-xs text-orange-700 dark:text-orange-400 mb-3">
                Describe los problemas específicos que la IA debe corregir. Sé lo más específico posible.
            </p>

            <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Ej: El quiz solo tiene 2 preguntas, necesita al menos 3. Faltan explicaciones en las opciones B y D."
                className="w-full p-3 text-sm border border-orange-200 dark:border-orange-700 rounded-lg bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
                rows={3}
                disabled={isSubmitting}
            />

            <div className="flex justify-end mt-3">
                <button
                    onClick={handleSubmit}
                    disabled={!instructions.trim() || isSubmitting || (!selectAll && selectedComponents.length === 0)}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    {isSubmitting ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                        <RefreshCw className="h-4 w-4" />
                    )}
                    {selectAll
                        ? 'Regenerar Todo'
                        : `Regenerar ${selectedComponents.length} componente${selectedComponents.length !== 1 ? 's' : ''}`
                    }
                </button>
            </div>
        </div>
    );
}
