'use client';

import { useState } from 'react';
import { useMaterials, useMaterialStateStyles } from '../hooks/useMaterials';
import { LessonMaterialsCard } from './LessonMaterialsCard';
import {
    Loader2,
    Play,
    Send,
    CheckCircle,
    AlertTriangle,
    RefreshCw,
} from 'lucide-react';

interface MaterialsFormProps {
    artifactId: string;
    className?: string;
}

export function MaterialsForm({ artifactId, className = '' }: MaterialsFormProps) {
    const {
        materials,
        loading,
        error,
        startGeneration,
        runFixIteration,
        submitToQA,
        applyQADecision,
        refresh,
        isGenerating,
        isReadyForQA,
        isApproved,
    } = useMaterials(artifactId);

    const { label: stateLabel, color: stateColor } = useMaterialStateStyles(materials?.state);
    const [qaNote, setQaNote] = useState('');

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

    const handleQADecision = async (decision: 'APPROVED' | 'REJECTED') => {
        await applyQADecision(decision, qaNote);
        setQaNote('');
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
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle className="h-5 w-5" />
                    <span>{error}</span>
                </div>
                <button
                    onClick={refresh}
                    className="mt-2 text-sm text-red-600 hover:underline"
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
                <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-lg">
                    <Play className="h-12 w-12 mx-auto text-gray-400 mb-4" />
                    <h3 className="text-lg font-medium text-gray-900 mb-2">
                        Generar Materiales (Paso 5)
                    </h3>
                    <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
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
                </div>
                <button
                    onClick={refresh}
                    className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    title="Actualizar"
                >
                    <RefreshCw className="h-4 w-4" />
                </button>
            </div>

            {/* Generation in progress */}
            {isGenerating && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-3">
                        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                        <div>
                            <p className="font-medium text-blue-800">Generando materiales...</p>
                            <p className="text-sm text-blue-600">
                                Este proceso puede tomar varios minutos dependiendo del número de lecciones.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Stats */}
            {materials.lessons.length > 0 && (
                <div className="grid grid-cols-4 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg text-center">
                        <p className="text-2xl font-bold text-gray-900">{materials.lessons.length}</p>
                        <p className="text-xs text-gray-500">Lecciones</p>
                    </div>
                    <div className="p-3 bg-green-50 rounded-lg text-center">
                        <p className="text-2xl font-bold text-green-600">
                            {materials.lessons.filter((l) => l.state === 'APPROVABLE').length}
                        </p>
                        <p className="text-xs text-gray-500">Listas</p>
                    </div>
                    <div className="p-3 bg-orange-50 rounded-lg text-center">
                        <p className="text-2xl font-bold text-orange-600">
                            {materials.lessons.filter((l) => l.state === 'NEEDS_FIX').length}
                        </p>
                        <p className="text-xs text-gray-500">Por corregir</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-lg text-center">
                        <p className="text-2xl font-bold text-blue-600">
                            {materials.lessons.filter((l) => ['GENERATING', 'VALIDATING'].includes(l.state)).length}
                        </p>
                        <p className="text-xs text-gray-500">En proceso</p>
                    </div>
                </div>
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
                <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg space-y-4">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-purple-600" />
                        <span className="font-medium text-purple-800">Pendiente de revisión QA</span>
                    </div>
                    <textarea
                        value={qaNote}
                        onChange={(e) => setQaNote(e.target.value)}
                        placeholder="Notas de revisión (opcional)"
                        className="w-full p-3 text-sm border border-purple-200 rounded-lg"
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
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-600" />
                        <span className="font-medium text-green-800">
                            ¡Materiales aprobados! Listos para producción.
                        </span>
                    </div>
                    {materials.qa_decision?.notes && (
                        <p className="mt-2 text-sm text-green-700">
                            Notas QA: {materials.qa_decision.notes}
                        </p>
                    )}
                </div>
            )}

            {/* Lessons by Module */}
            <div className="space-y-6">
                {Object.values(lessonsByModule).map((module) => (
                    <div key={module.module_id} className="space-y-3">
                        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
                            {module.module_title}
                        </h4>
                        <div className="space-y-2">
                            {module.lessons.map((lesson) => (
                                <LessonMaterialsCard
                                    key={lesson.id}
                                    lesson={lesson}
                                    onIterationStart={handleIterationStart}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
