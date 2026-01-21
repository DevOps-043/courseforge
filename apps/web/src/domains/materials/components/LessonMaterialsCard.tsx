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
    className?: string;
}

export function LessonMaterialsCard({ lesson, onIterationStart, className = '' }: LessonMaterialsCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [components, setComponents] = useState<MaterialComponent[]>([]);
    const [loadingComponents, setLoadingComponents] = useState(false);

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
            PENDING: 'bg-gray-100',
            GENERATING: 'bg-blue-50',
            GENERATED: 'bg-blue-50',
            VALIDATING: 'bg-yellow-50',
            APPROVABLE: 'bg-green-50',
            NEEDS_FIX: 'bg-orange-50',
            BLOCKED: 'bg-red-50',
        };
        return colors[state];
    };

    const handleIterationStart = (instructions: string) => {
        if (onIterationStart) {
            onIterationStart(lesson.id, instructions);
        }
    };

    return (
        <div className={`border rounded-lg overflow-hidden ${getStateBg(lesson.state)} ${className}`}>
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/50 transition-colors"
            >
                <div className="flex items-center gap-3">
                    {getStateIcon(lesson.state)}
                    <div className="text-left">
                        <h4 className="font-medium text-gray-900">{lesson.lesson_title}</h4>
                        <p className="text-xs text-gray-500">{lesson.module_title}</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${lesson.state === 'APPROVABLE' ? 'bg-green-100 text-green-800' :
                            lesson.state === 'NEEDS_FIX' ? 'bg-orange-100 text-orange-800' :
                                lesson.state === 'BLOCKED' ? 'bg-red-100 text-red-800' :
                                    'bg-gray-100 text-gray-800'
                        }`}>
                        {getStateLabel(lesson.state)}
                    </span>
                    {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
            </button>

            {/* Expanded Content */}
            {expanded && (
                <div className="border-t bg-white p-4 space-y-4">
                    {/* OA */}
                    <div className="p-3 bg-gray-50 rounded-lg">
                        <p className="text-xs text-gray-500 mb-1">Objetivo de Aprendizaje:</p>
                        <p className="text-sm">{lesson.oa_text}</p>
                    </div>

                    {/* Expected Components */}
                    <div>
                        <p className="text-xs text-gray-500 mb-2">Componentes esperados:</p>
                        <div className="flex flex-wrap gap-2">
                            {lesson.expected_components.map((comp) => {
                                const generated = components.find((c) => c.type === comp);
                                return (
                                    <span
                                        key={comp}
                                        className={`text-xs px-2 py-1 rounded ${generated
                                                ? 'bg-green-100 text-green-800'
                                                : 'bg-gray-100 text-gray-600'
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
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        </div>
                    ) : components.length > 0 ? (
                        <div className="space-y-3">
                            <h5 className="text-sm font-medium">Materiales generados:</h5>
                            {components.map((comp) => (
                                <ComponentViewer key={comp.id} component={comp} />
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 text-center py-4">
                            No hay materiales generados aún
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
