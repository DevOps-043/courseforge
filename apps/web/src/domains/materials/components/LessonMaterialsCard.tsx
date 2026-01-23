'use client';

import { useState, useEffect } from 'react';
import {
    MaterialLesson,
    MaterialComponent,
    LessonMaterialState,
} from '../types/materials.types';
import { materialsService } from '../services/materials.service';
import { ComponentViewer } from './ComponentViewer';
import { MaterialsDodChecklist } from './MaterialsDodChecklist';
import { IterationPanel } from './IterationPanel';
import {
    ChevronDown,
    ChevronUp,
    Loader2,
    CheckCircle,
    AlertTriangle,
    Clock,
    XCircle,
} from 'lucide-react';

interface LessonMaterialsCardProps {
    lesson: MaterialLesson;
    onIterationStart?: (lessonId: string, instructions: string) => void;
    onValidateLesson?: (lessonId: string) => Promise<void>;
    onRegenerateLesson?: (lessonId: string) => Promise<void>;
    onMarkForFix?: (lessonId: string) => Promise<void>;
    className?: string;
}

export function LessonMaterialsCard({ lesson, onIterationStart, onValidateLesson, onRegenerateLesson, onMarkForFix, className = '' }: LessonMaterialsCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [components, setComponents] = useState<MaterialComponent[]>([]);
    const [loadingComponents, setLoadingComponents] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [isMarking, setIsMarking] = useState(false);

    // Load components when expanded
    useEffect(() => {
        if (expanded && components.length === 0) {
            loadComponents();
        }
    }, [expanded]);

    const loadComponents = async () => {
        setLoadingComponents(true);
        try {
            const data = await materialsService.getLessonComponents(lesson.id);
            setComponents(data);
        } catch (error) {
            console.error('Error loading components:', error);
        } finally {
            setLoadingComponents(false);
        }
    };

    const getStateIcon = (state: LessonMaterialState) => {
        const icons: Record<LessonMaterialState, React.ReactNode> = {
            PENDING: <Clock className="h-4 w-4 text-gray-400" />,
            GENERATING: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
            GENERATED: <CheckCircle className="h-4 w-4 text-blue-500" />,
            VALIDATING: <Loader2 className="h-4 w-4 text-yellow-500 animate-spin" />,
            APPROVABLE: <CheckCircle className="h-4 w-4 text-green-500" />,
            NEEDS_FIX: <AlertTriangle className="h-4 w-4 text-orange-500" />,
            BLOCKED: <XCircle className="h-4 w-4 text-red-500" />,
        };
        return icons[state];
    };

    const getStateLabel = (state: LessonMaterialState) => {
        const labels: Record<LessonMaterialState, string> = {
            PENDING: 'Pendiente',
            GENERATING: 'Generando...',
            GENERATED: 'Generado',
            VALIDATING: 'Validando...',
            APPROVABLE: 'Listo',
            NEEDS_FIX: 'Requiere corrección',
            BLOCKED: 'Bloqueado',
        };
        return labels[state];
    };

    const getStateBg = (state: LessonMaterialState) => {
        const colors: Record<LessonMaterialState, string> = {
            PENDING: 'bg-gray-100 dark:bg-white/5',
            GENERATING: 'bg-blue-50 dark:bg-blue-900/20',
            GENERATED: 'bg-blue-50 dark:bg-blue-900/20',
            VALIDATING: 'bg-yellow-50 dark:bg-yellow-900/20',
            APPROVABLE: 'bg-green-50 dark:bg-green-900/20',
            NEEDS_FIX: 'bg-orange-50 dark:bg-orange-900/20',
            BLOCKED: 'bg-red-50 dark:bg-red-900/20',
        };
        return colors[state];
    };

    const handleIterationStart = (instructions: string) => {
        if (onIterationStart) {
            onIterationStart(lesson.id, instructions);
        }
    };

    const handleValidate = async () => {
        if (!onValidateLesson) return;
        setIsValidating(true);
        try {
            await onValidateLesson(lesson.id);
        } finally {
            setIsValidating(false);
        }
    };

    const handleRegenerate = async () => {
        if (!onRegenerateLesson) return;
        setIsRegenerating(true);
        try {
            await onRegenerateLesson(lesson.id);
        } finally {
            setIsRegenerating(false);
        }
    };

    const handleMarkForFix = async () => {
        if (!onMarkForFix) return;
        setIsMarking(true);
        try {
            await onMarkForFix(lesson.id);
        } finally {
            setIsMarking(false);
        }
    };

    return (
        <div className={`border dark:border-white/10 rounded-lg overflow-hidden ${getStateBg(lesson.state)} ${className}`}>
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/50 dark:hover:bg-white/5 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {getStateIcon(lesson.state)}
                    <div className="text-left">
                        <h4 className="font-medium text-gray-900 dark:text-white">{lesson.lesson_title}</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{lesson.module_title}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${lesson.state === 'APPROVABLE' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                        lesson.state === 'NEEDS_FIX' ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300' :
                            lesson.state === 'BLOCKED' ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300' :
                                'bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-300'
                        }`}>
                        {getStateLabel(lesson.state)}
                    </span>
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
            </button>

            {/* Expanded Content */}
            {expanded && (
                <div className="border-t dark:border-white/10 bg-white dark:bg-[#1E2329] p-4 space-y-4">
                    {/* OA */}
                    <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Objetivo de Aprendizaje:</p>
                        <p className="text-sm dark:text-gray-200">{lesson.oa_text}</p>
                    </div>

                    {/* Expected Components */}
                    <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Componentes esperados:</p>
                        <div className="flex flex-wrap gap-2">
                            {lesson.expected_components.map((comp) => {
                                const generated = components.find((c) => c.type === comp);
                                return (
                                    <span
                                        key={comp}
                                        className={`text-xs px-2 py-1 rounded ${generated
                                            ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
                                            : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-400'
                                            }`}
                                    >
                                        {comp}
                                        {generated && ' ✓'}
                                    </span>
                                );
                            })}
                        </div>
                    </div>

                    {/* DoD Checklist */}
                    {lesson.dod && (
                        <MaterialsDodChecklist dod={lesson.dod} />
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2 border-t dark:border-white/10">
                        {/* Validate Button - show when GENERATED or PENDING */}
                        {(lesson.state === 'GENERATED' || lesson.state === 'PENDING') && onValidateLesson && (
                            <button
                                onClick={handleValidate}
                                disabled={isValidating}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-yellow-700 bg-yellow-100 hover:bg-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:hover:bg-yellow-900/50 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {isValidating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                                Validar
                            </button>
                        )}

                        {/* Regenerate Button - show when NEEDS_FIX */}
                        {lesson.state === 'NEEDS_FIX' && onRegenerateLesson && (
                            <button
                                onClick={handleRegenerate}
                                disabled={isRegenerating || lesson.iteration_count >= lesson.max_iterations}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-orange-700 bg-orange-100 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:hover:bg-orange-900/50 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {isRegenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                                Regenerar ({lesson.iteration_count}/{lesson.max_iterations})
                            </button>
                        )}

                        {/* Mark for Fix Button - show when APPROVABLE or GENERATED */}
                        {(lesson.state === 'APPROVABLE' || lesson.state === 'GENERATED') && onMarkForFix && (
                            <button
                                onClick={handleMarkForFix}
                                disabled={isMarking}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {isMarking ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                                Marcar para Corrección
                            </button>
                        )}
                    </div>

                    {/* Iteration Panel */}
                    {lesson.state === 'NEEDS_FIX' && (
                        <IterationPanel
                            currentIteration={lesson.iteration_count}
                            maxIterations={lesson.max_iterations}
                            onStartIteration={handleIterationStart}
                        />
                    )}

                    {/* Components */}
                    {loadingComponents ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
                        </div>
                    ) : components.length > 0 ? (
                        <div className="space-y-3">
                            <h5 className="text-sm font-medium dark:text-white">Materiales generados:</h5>
                            {components.map((comp) => (
                                <ComponentViewer key={comp.id} component={comp} />
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                            No hay materiales generados aún
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
