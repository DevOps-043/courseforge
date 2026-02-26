'use client';

import { useState } from 'react';
import { useMaterials, useMaterialStateStyles } from '../hooks/useMaterials';
import { LessonMaterialsCard } from './LessonMaterialsCard';
import { useRouter } from 'next/navigation';
import {
    Loader2,
    Play,
    Send,
    CheckCircle,
    AlertTriangle,
    RefreshCw,
    XCircle,
    Clock,
} from 'lucide-react';

interface MaterialsFormProps {
    artifactId: string;
    className?: string;
}

export function MaterialsForm({ artifactId, className = '' }: MaterialsFormProps) {
    const router = useRouter();
    const {
        materials,
        loading,
        error,
        startGeneration,
        runFixIteration,
        submitToQA,
        applyQADecision,
        validateMaterials,
        forceResetGeneration,
        refresh,
        isGenerating,
        isValidating,
        isReadyForQA,
        isApproved,
        generationStuckInfo,
    } = useMaterials(artifactId);

    const { label: stateLabel, color: stateColor } = useMaterialStateStyles(materials?.state);
    const [qaNote, setQaNote] = useState('');
    const [isValidatingAll, setIsValidatingAll] = useState(false);
    const [isResetting, setIsResetting] = useState(false);

    const handleForceReset = async () => {
        if (!confirm('¿Estás seguro de que quieres cancelar la generación actual? Esto permitirá iniciar una nueva generación.')) {
            return;
        }
        setIsResetting(true);
        await forceResetGeneration();
        setIsResetting(false);
    };

    // Group lessons by module
    const lessonsByModule = materials?.lessons.reduce((acc, lesson) => {
        const moduleKey = lesson.module_id;
        if (!acc[moduleKey]) {
            acc[moduleKey] = {
                module_id: lesson.module_id,
                module_title: lesson.module_title,
                lessons: [],
            };
        }
        acc[moduleKey].lessons.push(lesson);
        return acc;
    }, {} as Record<string, { module_id: string; module_title: string; lessons: typeof materials.lessons }>) || {};

    const handleIterationStart = async (lessonId: string, instructions: string) => {
        await runFixIteration(lessonId, instructions);
    };

    // Real-time updates are handled by Supabase subscriptions in useMaterials hook

    const handleValidateLesson = async (lessonId: string) => {
        // Call the validate endpoint
        const response = await fetch('/.netlify/functions/validate-materials-background', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lessonId }),
        });
        if (response.ok) {
            refresh();
        }
    };

    const handleRegenerateLesson = async (lessonId: string) => {
        await runFixIteration(lessonId, 'Regenerar completamente esta lección siguiendo el plan original.');
    };

    const handleMarkForFix = async (lessonId: string) => {
        // Simply update the lesson state to NEEDS_FIX
        const response = await fetch('/.netlify/functions/validate-materials-background', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lessonId, markForFix: true }),
        });
        if (response.ok) {
            refresh();
        }
    };

    const handleQADecision = async (decision: 'APPROVED' | 'REJECTED') => {
        await applyQADecision(decision, qaNote);
        setQaNote('');
        router.refresh();
    };

    // Loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <AlertTriangle className="h-5 w-5" />
                    <span>{error}</span>
                </div>
                <button
                    onClick={refresh}
                    className="mt-2 text-sm text-red-600 dark:text-red-400 hover:underline"
                >
                    Reintentar
                </button>
            </div>
        );
    }

    // No materials yet - show start button
    if (!materials || materials.state === 'PHASE3_DRAFT') {
        return (
            <div className={`space-y-6 ${className}`}>
                <div className="text-center py-12 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-lg">
                    <Play className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-500 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                        Generar Materiales (Paso 5)
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
                        Se generarán los materiales para cada lección basándose en el plan instruccional
                        (Paso 3) y las fuentes curadas (Paso 4).
                    </p>
                    <button
                        onClick={startGeneration}
                        className="inline-flex items-center gap-2 px-6 py-3 text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                        <Play className="h-5 w-5" />
                        Iniciar Generación
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`space-y-6 ${className}`}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold">Materiales (Fase 3)</h3>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${stateColor}`}>
                        {stateLabel}
                    </span>
                    {(isGenerating || isValidating) && (
                        <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Actualizando...
                        </span>
                    )}
                </div>
            </div>

            {/* Generation in progress */}
            {isGenerating && (
                <div className={`p-4 border rounded-lg ${generationStuckInfo?.isStuck
                    ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
                    : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'}`}
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {generationStuckInfo?.isStuck ? (
                                <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                            ) : (
                                <Loader2 className="h-5 w-5 animate-spin text-blue-600 dark:text-blue-400" />
                            )}
                            <div>
                                <p className={`font-medium ${generationStuckInfo?.isStuck
                                    ? 'text-orange-800 dark:text-orange-300'
                                    : 'text-blue-800 dark:text-blue-300'}`}>
                                    {generationStuckInfo?.isStuck
                                        ? '⚠️ Generación posiblemente bloqueada'
                                        : 'Generando materiales...'}
                                </p>
                                <p className={`text-sm ${generationStuckInfo?.isStuck
                                    ? 'text-orange-600 dark:text-orange-400'
                                    : 'text-blue-600 dark:text-blue-400'}`}>
                                    {generationStuckInfo?.minutesElapsed
                                        ? `Tiempo transcurrido: ${generationStuckInfo.minutesElapsed} minutos`
                                        : 'Este proceso puede tomar varios minutos dependiendo del número de lecciones.'}
                                </p>
                                {generationStuckInfo?.isStuck && (
                                    <p className="text-xs text-orange-500 dark:text-orange-400 mt-1">
                                        La generación lleva más de 30 minutos. Puedes cancelarla e intentar de nuevo.
                                    </p>
                                )}
                            </div>
                        </div>
                        {generationStuckInfo?.minutesElapsed && generationStuckInfo.minutesElapsed >= 5 && (
                            <button
                                onClick={handleForceReset}
                                disabled={isResetting}
                                className="inline-flex items-center gap-2 px-4 py-2 text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors font-medium"
                            >
                                {isResetting ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Cancelando...
                                    </>
                                ) : (
                                    <>
                                        <XCircle className="h-4 w-4" />
                                        Cancelar Generación
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                    {generationStuckInfo?.minutesElapsed && generationStuckInfo.minutesElapsed < 5 && (
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            El botón de cancelar aparecerá después de 5 minutos si la generación no progresa.
                        </p>
                    )}
                </div>
            )}

            {/* Validation needed / in progress */}
            {isValidating && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <CheckCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                            <div>
                                <p className="font-medium text-yellow-800 dark:text-yellow-300">Materiales generados - Validación pendiente</p>
                                <p className="text-sm text-yellow-600 dark:text-yellow-400">
                                    Ejecuta la validación para verificar la calidad de los materiales generados.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={async () => {
                                setIsValidatingAll(true);
                                await validateMaterials();
                                await refresh();
                                setIsValidatingAll(false);
                            }}
                            disabled={isValidatingAll}
                            className="inline-flex items-center gap-2 px-4 py-2 text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 transition-colors font-medium disabled:opacity-50"
                        >
                            {isValidatingAll ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Validando...
                                </>
                            ) : (
                                <>
                                    <CheckCircle className="h-4 w-4" />
                                    Validar Materiales
                                </>
                            )}
                        </button>
                    </div>
                </div>
            )}

            {/* Stats */}
            {materials.lessons.length > 0 && (
                <div className="grid grid-cols-4 gap-4">
                    <div className="p-3 bg-gray-50 dark:bg-white/5 rounded-lg text-center border border-transparent dark:border-white/10">
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{materials.lessons.length}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Lecciones</p>
                    </div>
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-center border border-transparent dark:border-green-800">
                        <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                            {materials.lessons.filter((l) => l.state === 'APPROVABLE').length}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Listas</p>
                    </div>
                    <div className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg text-center border border-transparent dark:border-orange-800">
                        <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                            {materials.lessons.filter((l) => l.state === 'NEEDS_FIX').length}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Por corregir</p>
                    </div>
                    <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-center border border-transparent dark:border-blue-800">
                        <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                            {materials.lessons.filter((l) => ['GENERATING', 'VALIDATING'].includes(l.state)).length}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">En proceso</p>
                    </div>
                </div>
            )}

            {/* Bulk Regenerate Button - show when there are NEEDS_FIX lessons */}
            {materials.lessons.filter((l) => l.state === 'NEEDS_FIX').length > 0 && !isGenerating && (
                <button
                    onClick={async () => {
                        const needsFixLessons = materials.lessons.filter((l) => l.state === 'NEEDS_FIX');
                        for (const lesson of needsFixLessons) {
                            await runFixIteration(lesson.id, 'Regenerar esta lección corrigiendo los errores identificados.');
                        }
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 text-white bg-orange-600 rounded-lg hover:bg-orange-700 transition-colors font-medium"
                >
                    <RefreshCw className="h-4 w-4" />
                    Regenerar Todas las Pendientes ({materials.lessons.filter((l) => l.state === 'NEEDS_FIX').length})
                </button>
            )}

            {/* Submit to QA Button */}
            {!isReadyForQA && !isApproved && materials.lessons.length > 0 && (
                <div className="flex justify-end">
                    <button
                        onClick={submitToQA}
                        disabled={!materials.lessons.every((l) => l.state === 'APPROVABLE')}
                        className="inline-flex items-center gap-2 px-4 py-2 text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Send className="h-4 w-4" />
                        Enviar a QA
                    </button>
                </div>
            )}

            {/* QA Review Panel */}
            {isReadyForQA && (
                <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg space-y-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                        <span className="font-medium text-purple-800 dark:text-purple-300">Pendiente de revisión QA</span>
                    </div>
                    <textarea
                        value={qaNote}
                        onChange={(e) => setQaNote(e.target.value)}
                        placeholder="Notas de revisión (opcional)"
                        className="w-full p-3 text-sm border border-purple-200 dark:border-purple-700 rounded-lg bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white placeholder-gray-400"
                        rows={2}
                    />
                    <div className="flex gap-3">
                        <button
                            onClick={() => handleQADecision('APPROVED')}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                        >
                            <CheckCircle className="h-4 w-4" />
                            Aprobar
                        </button>
                        <button
                            onClick={() => handleQADecision('REJECTED')}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                        >
                            <AlertTriangle className="h-4 w-4" />
                            Rechazar
                        </button>
                    </div>
                </div>
            )}

            {/* Approved State */}
            {isApproved && (
                <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400" />
                        <span className="font-medium text-green-800 dark:text-green-300">
                            ¡Materiales aprobados! Listos para producción.
                        </span>
                    </div>
                    {materials.qa_decision?.notes && (
                        <p className="mt-2 text-sm text-green-700 dark:text-green-400">
                            Notas QA: {materials.qa_decision.notes}
                        </p>
                    )}
                </div>
            )}

            {/* Lessons by Module */}
            <div className="space-y-6">
                {Object.values(lessonsByModule).map((module) => (
                    <div key={module.module_id} className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                            {module.module_title}
                        </h4>
                        <div className="space-y-2">
                            {module.lessons.map((lesson) => (
                                <LessonMaterialsCard
                                    key={lesson.id}
                                    lesson={lesson}
                                    onIterationStart={handleIterationStart}
                                    onValidateLesson={handleValidateLesson}
                                    onRegenerateLesson={handleRegenerateLesson}
                                    onMarkForFix={handleMarkForFix}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
