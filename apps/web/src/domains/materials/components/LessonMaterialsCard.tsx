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
    XCircle,
    ExternalLink,
    Sparkles,
    ChevronDown,
    ChevronUp,
    Loader2,
    CheckCircle,
    AlertTriangle,
    Clock,
} from 'lucide-react';
import { MaterialDetailsModal } from './MaterialDetailsModal';

interface LessonMaterialsCardProps {
    lesson: MaterialLesson;
    onIterationStart?: (lessonId: string, instructions: string) => void;
    className?: string;
}

export function LessonMaterialsCard({ lesson, onIterationStart, className = '' }: LessonMaterialsCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [components, setComponents] = useState<MaterialComponent[]>([]);
    const [loadingComponents, setLoadingComponents] = useState(false);
    const [showModal, setShowModal] = useState(false);

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

    return (
        <div className={`border rounded-2xl overflow-hidden transition-all duration-300 shadow-lg shadow-black/5 dark:shadow-black/20 
            bg-white dark:bg-[#1E2329] border-gray-200 dark:border-white/5 
            hover:border-gray-300 dark:hover:border-[#00D4B3]/30 ${className}`}>
            {/* Header */}
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-6 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors group"
            >
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center 
                        bg-gray-100 dark:bg-[#0A2540] border border-gray-200 dark:border-white/5 
                        text-gray-600 dark:text-[#00D4B3]">
                        {getStateIcon(lesson.state)}
                    </div>
                    <div className="text-left">
                        <h4 className="font-semibold text-lg text-gray-900 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-white transition-colors">
                            {lesson.lesson_title}
                        </h4>
                        <p className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">
                            {lesson.module_title}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <span className={`text-xs px-3 py-1 rounded-full border ${lesson.state === 'APPROVABLE' ? 'bg-[#00D4B3]/10 border-[#00D4B3]/20 text-[#00D4B3]' :
                        lesson.state === 'NEEDS_FIX' ? 'bg-[#F59E0B]/10 border-[#F59E0B]/20 text-[#F59E0B]' :
                            lesson.state === 'BLOCKED' ? 'bg-red-500/10 border-red-500/20 text-red-500' :
                                'bg-white/5 border-white/10 text-gray-400'
                        }`}>
                        {getStateLabel(lesson.state)}
                    </span>
                    <div className={`transition-transform duration-300 ${expanded ? 'rotate-180' : ''}`}>
                         <ChevronDown className="h-5 w-5 text-gray-500 group-hover:text-white" />
                    </div>
                </div>
            </button>

            {/* Expanded Content */}
            {expanded && (
                <div className="border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-[#0F1419]/50 p-6 space-y-6">
                    {/* OA */}
                    <div className="p-4 rounded-xl relative pl-10 
                        bg-white dark:bg-[#0A2540]/20 border border-gray-200 dark:border-[#0A2540]/30">
                        <span className="absolute top-4 left-4 text-4xl leading-none opacity-30 
                            text-blue-500 dark:text-[#00D4B3]">"</span>
                        <p className="text-xs font-bold mb-1 uppercase tracking-wider 
                            text-blue-600 dark:text-[#00D4B3]">Objetivo de Aprendizaje</p>
                        <p className="text-sm leading-relaxed italic 
                            text-gray-700 dark:text-gray-200">{lesson.oa_text}</p>
                    </div>

                    {/* Expected Components */}
                    {/* Expected Components */}
                    <div>
                        <p className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wider pl-1">Componentes Requeridos</p>
                        <div className="flex flex-wrap gap-2">
                            {lesson.expected_components.map((comp) => {
                                const generated = components.find((c) => c.type === comp);
                                return (
                                    <div
                                        key={comp}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                            generated
                                            ? 'bg-green-50 dark:bg-[#00D4B3]/10 border-green-200 dark:border-[#00D4B3]/30 text-green-700 dark:text-[#00D4B3]'
                                            : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/5 text-gray-400 dark:text-gray-500'
                                        }`}
                                    >
                                        <div className={`w-1.5 h-1.5 rounded-full ${generated ? 'bg-green-500 dark:bg-[#00D4B3]' : 'bg-gray-300 dark:bg-gray-600'}`} />
                                        {comp.replace(/_/g, ' ')}
                                    </div>
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
                    {/* Components Link */}
                    {loadingComponents ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400 dark:text-gray-500" />
                        </div>
                    ) : components.length > 0 ? (
                        <div className="pt-2">
                             <button
                                onClick={() => setShowModal(true)}
                                className="w-full group relative overflow-hidden rounded-xl bg-gradient-to-br from-[#0A2540] to-[#1E2329] p-6 border border-white/10 hover:border-[#00D4B3]/50 transition-all duration-300"
                            >
                                <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-10" />
                                <div className="absolute inset-0 bg-gradient-to-r from-[#00D4B3]/0 via-[#00D4B3]/5 to-[#00D4B3]/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                                
                                <div className="relative flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 rounded-lg flex items-center justify-center transition-transform group-hover:scale-110
                                            bg-white/20 dark:bg-[#00D4B3]/10">
                                            <Sparkles className="w-6 h-6 text-white dark:text-[#00D4B3]" />
                                        </div>
                                        <div className="text-left">
                                            <h4 className="font-medium text-lg text-white">Explorar Materiales Generados</h4>
                                            <p className="text-blue-100 dark:text-gray-400 text-sm">
                                                Revisar {components.length} componentes, DoD y realizar iteraciones
                                            </p>
                                        </div>
                                    </div>
                                    <div className="w-10 h-10 rounded-full bg-white/20 dark:bg-white/5 flex items-center justify-center group-hover:bg-white group-hover:text-blue-600 dark:group-hover:bg-[#00D4B3] dark:group-hover:text-white transition-colors">
                                        <ExternalLink className="w-5 h-5" />
                                    </div>
                                </div>
                            </button>
                        </div>
                    ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
                            No hay materiales generados aún
                        </p>
                    )}
                </div>
            )}

            <MaterialDetailsModal 
                lesson={lesson}
                components={components}
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                onIterationStart={handleIterationStart}
            />
        </div>
    );
}
