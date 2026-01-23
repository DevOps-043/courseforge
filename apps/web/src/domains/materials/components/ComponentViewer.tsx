'use client';

import { useState } from 'react';
import {
    MaterialComponent,
    ComponentType,
    DialogueContent,
    ReadingContent,
    QuizContent,
    DemoGuideContent,
    ExerciseContent,
    VideoContent,
} from '../types/materials.types';
import {
    MessageSquare,
    BookOpen,
    HelpCircle,
    Play,
    ListOrdered,
    ChevronDown,
    ChevronUp,
    User,
    Bot,
} from 'lucide-react';

interface ComponentViewerProps {
    component: MaterialComponent;
    variant?: 'card' | 'embedded';
    className?: string;
}

export function ComponentViewer({ component, variant = 'card', className = '' }: ComponentViewerProps) {
    const [expanded, setExpanded] = useState(true);

    const getIcon = (type: ComponentType) => {
        const icons: Record<ComponentType, React.ReactNode> = {
            DIALOGUE: <MessageSquare className="h-4 w-4" />,
            READING: <BookOpen className="h-4 w-4" />,
            QUIZ: <HelpCircle className="h-4 w-4" />,
            DEMO_GUIDE: <ListOrdered className="h-4 w-4" />,
            EXERCISE: <ListOrdered className="h-4 w-4" />,
            VIDEO_THEORETICAL: <Play className="h-4 w-4" />,
            VIDEO_DEMO: <Play className="h-4 w-4" />,
            VIDEO_GUIDE: <Play className="h-4 w-4" />,
        };
        return icons[type] || <BookOpen className="h-4 w-4" />;
    };

    const getLabel = (type: ComponentType) => {
        const labels: Record<ComponentType, string> = {
            DIALOGUE: 'Diálogo con Lia',
            READING: 'Lectura',
            QUIZ: 'Cuestionario',
            DEMO_GUIDE: 'Guía Demo',
            EXERCISE: 'Ejercicio',
            VIDEO_THEORETICAL: 'Video Teórico',
            VIDEO_DEMO: 'Video Demo',
            VIDEO_GUIDE: 'Video Guía',
        };
        return labels[type] || type;
    };

    const renderContent = () => {
        switch (component.type) {
            case 'DIALOGUE':
                return <DialogueViewer content={component.content as DialogueContent} />;
            case 'READING':
                return <ReadingViewer content={component.content as ReadingContent} />;
            case 'QUIZ':
                return <QuizViewer content={component.content as QuizContent} />;
            case 'DEMO_GUIDE':
                return <DemoGuideViewer content={component.content as DemoGuideContent} />;
            case 'EXERCISE':
                return <ExerciseViewer content={component.content as ExerciseContent} />;
            case 'VIDEO_THEORETICAL':
            case 'VIDEO_DEMO':
            case 'VIDEO_GUIDE':
                return <VideoViewer content={component.content as VideoContent} />;
            default:
                return <pre className="text-xs overflow-auto">{JSON.stringify(component.content, null, 2)}</pre>;
        }
    };

    if (variant === 'embedded') {
        return (
            <div className={className}>
                {renderContent()}
            </div>
        );
    }

    return (
        <div className={`border dark:border-white/10 rounded-lg overflow-hidden ${className}`}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {getIcon(component.type)}
                    <span className="font-medium text-sm dark:text-white">{getLabel(component.type)}</span>
                </div>
                {expanded ? <ChevronUp className="h-4 w-4 dark:text-gray-400" /> : <ChevronDown className="h-4 w-4 dark:text-gray-400" />}
            </button>

            {expanded && (
                <div className="p-4 bg-white dark:bg-[#1E2329]">
                    {renderContent()}
                </div>
            )}
        </div>
    );
}

// === SUB-VIEWERS ===

function DialogueViewer({ content }: { content: DialogueContent }) {
    return (
        <div className="space-y-3">
            {content.title && <h4 className="font-semibold dark:text-white">{content.title}</h4>}
            {content.introduction && <p className="text-sm text-gray-600 dark:text-gray-400 italic">{content.introduction}</p>}

            <div className="space-y-4">
                {content.scenes?.map((scene, i) => (
                    <div key={i} className={`flex gap-3 ${scene.character === 'Usuario' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-lg ${
                            scene.character === 'Lia' 
                                ? 'bg-[#00D4B3] text-[#0A2540]' 
                                : scene.character === 'Usuario' 
                                    ? 'bg-[#0A2540] border border-[#00D4B3]/30 text-[#00D4B3]' 
                                    : 'bg-gray-100 dark:bg-white/10'
                            }`}>
                            {scene.character === 'Lia' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                        </div>
                        <div className={`max-w-[80%] p-3.5 rounded-2xl text-sm ${
                            scene.character === 'Usuario' 
                                ? 'bg-[#0A2540] border border-[#00D4B3]/20 text-gray-200 rounded-tr-sm' 
                                : 'bg-[#1E2329] border border-white/5 text-gray-200 rounded-tl-sm'
                            }`}>
                            <p className="text-xs font-semibold mb-1 opacity-50 uppercase tracking-wider">{scene.character}</p>
                            <p className="leading-relaxed">{scene.message}</p>
                        </div>
                    </div>
                ))}
            </div>

            {content.reflection_prompt && (
                <div className="mt-4 p-4 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-xl">
                    <p className="text-sm font-semibold text-[#F59E0B] mb-1 flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5" /> Reflexión
                    </p>
                    <p className="text-sm text-[#F59E0B]/90">{content.reflection_prompt}</p>
                </div>
            )}
        </div>
    );
}

function ReadingViewer({ content }: { content: ReadingContent }) {
    return (
        <div className="space-y-6">
            {content.title && <h4 className="font-bold text-xl dark:text-white">{content.title}</h4>}

            {content.estimated_reading_time_min && (
                <div className="flex items-center gap-2 text-xs text-[#00D4B3]">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{content.estimated_reading_time_min} min lectura</span>
                </div>
            )}

            {content.body_html && (
                <div
                    className="prose prose-sm dark:prose-invert max-w-none prose-p:text-gray-300 prose-headings:text-white prose-strong:text-white prose-a:text-[#00D4B3]"
                    dangerouslySetInnerHTML={{ __html: content.body_html }}
                />
            )}

            {content.key_points && content.key_points.length > 0 && (
                <div className="p-5 bg-[#0A2540]/30 border border-[#0A2540] rounded-xl">
                    <p className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#00D4B3]" />
                        Puntos Clave
                    </p>
                    <ul className="space-y-2">
                        {content.key_points.map((point, i) => (
                            <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#00D4B3] mt-2 flex-shrink-0" />
                                {point}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {content.reflection_question && (
                <div className="p-5 bg-gradient-to-r from-[#0A2540] to-[#1E2329] border-l-4 border-[#00D4B3] rounded-r-xl">
                    <p className="text-sm font-semibold text-[#00D4B3] mb-2">Pregunta de Reflexión</p>
                    <p className="text-base text-white italic">"{content.reflection_question}"</p>
                </div>
            )}
        </div>
    );
}

function QuizViewer({ content }: { content: QuizContent }) {
    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                {content.title && <h4 className="font-bold text-lg dark:text-white">{content.title}</h4>}
                <div className="px-3 py-1 bg-[#1E2329] rounded-full border border-white/10 text-xs text-gray-400">
                    Puntaje min: <span className="text-white font-bold">{content.passing_score}%</span>
                </div>
            </div>
            
            {content.instructions && <p className="text-sm text-gray-400">{content.instructions}</p>}

            <div className="space-y-6">
                {content.items?.map((item, i) => (
                    <div key={i} className="p-6 bg-[#131820] border border-white/5 rounded-2xl transition-colors hover:border-white/10">
                        <div className="flex gap-4 mb-4">
                            <span className="flex-shrink-0 w-8 h-8 bg-[#00D4B3]/10 text-[#00D4B3] rounded-lg flex items-center justify-center text-sm font-bold">
                                {i + 1}
                            </span>
                            <div className="flex-1">
                                <p className="text-base font-medium text-white mb-2">{item.question}</p>
                                <div className="flex gap-2">
                                    <span className="px-2 py-0.5 bg-white/5 rounded text-[10px] text-gray-400 uppercase tracking-wide">{item.type}</span>
                                    <span className="px-2 py-0.5 bg-white/5 rounded text-[10px] text-gray-400 uppercase tracking-wide">{item.difficulty}</span>
                                </div>
                            </div>
                        </div>

                        {item.options && (
                            <div className="space-y-2 pl-12">
                                {item.options.map((opt, j) => {
                                    const isCorrect = j === item.correct_answer || opt === item.correct_answer;
                                    return (
                                        <div
                                            key={j}
                                            className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                                                isCorrect
                                                    ? 'bg-[#00D4B3]/10 border-[#00D4B3]/50'
                                                    : 'bg-[#0F1419] border-white/5 text-gray-400'
                                            }`}
                                        >
                                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                                isCorrect ? 'border-[#00D4B3] bg-[#00D4B3]' : 'border-gray-600'
                                            }`}>
                                                {isCorrect && <CheckCircle className="w-3 h-3 text-[#0A2540]" />}
                                            </div>
                                            <span className={`text-sm ${isCorrect ? 'text-white font-medium' : ''}`}>{opt}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {item.explanation && (
                            <div className="mt-4 ml-12 p-3 bg-[#F59E0B]/10 border border-[#F59E0B]/20 rounded-xl flex gap-3">
                                <Sparkles className="w-4 h-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                                <div className="text-xs text-[#F59E0B]/90">
                                    <span className="font-bold text-[#F59E0B] block mb-0.5">Explicación</span>
                                    {item.explanation}
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function DemoGuideViewer({ content }: { content: DemoGuideContent }) {
    return (
        <div className="space-y-6">
            {content.title && <h4 className="font-bold text-lg dark:text-white">{content.title}</h4>}
            {content.objective && <p className="text-sm text-gray-400 border-l-2 border-[#00D4B3] pl-3 italic">{content.objective}</p>}

            {content.prerequisites && content.prerequisites.length > 0 && (
                <div className="p-4 bg-[#1E2329] border border-white/5 rounded-xl">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Prerrequisitos</p>
                    <ul className="space-y-1">
                        {content.prerequisites.map((p, i) => (
                            <li key={i} className="text-sm text-gray-300 flex items-center gap-2">
                                <span className="w-1 h-1 rounded-full bg-gray-500" />
                                {p}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="space-y-3">
                {content.steps?.map((step, i) => (
                    <div key={i} className="group relative flex gap-4 p-4 bg-[#131820] border border-white/5 rounded-xl transition-colors hover:border-white/10">
                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-[#0A2540] text-white rounded-lg border border-white/5 text-sm font-medium">
                            {step.step_number}
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-gray-200 font-medium mb-1.5">{step.instruction}</p>
                            {step.tip && (
                                <p className="text-xs text-[#00D4B3] flex items-center gap-1.5 mt-1">
                                    <Sparkles className="w-3 h-3" />
                                    {step.tip}
                                </p>
                            )}
                            {step.warning && (
                                <p className="text-xs text-[#F59E0B] flex items-center gap-1.5 mt-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    {step.warning}
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {content.summary && (
                <div className="p-4 bg-[#0A2540]/30 border border-[#00D4B3]/30 rounded-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#00D4B3]" />
                    <p className="text-sm font-semibold text-[#00D4B3] mb-1">Resumen</p>
                    <p className="text-sm text-gray-300">{content.summary}</p>
                </div>
            )}
        </div>
    );
}

function ExerciseViewer({ content }: { content: ExerciseContent }) {
    return (
        <div className="space-y-6">
            {content.title && <h4 className="font-bold text-lg dark:text-white">{content.title}</h4>}

            {content.body_html && (
                <div
                    className="prose prose-sm dark:prose-invert max-w-none prose-p:text-gray-300 pb-4 border-b border-white/5"
                    dangerouslySetInnerHTML={{ __html: content.body_html }}
                />
            )}

            {content.instructions && (
                <div className="p-5 bg-[#0A2540]/20 rounded-xl border border-white/5">
                    <p className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                        <ListOrdered className="w-4 h-4 text-[#00D4B3]" /> 
                        Instrucciones
                    </p>
                    <p className="text-sm text-gray-300 leading-relaxed">{content.instructions}</p>
                </div>
            )}

            {content.expected_outcome && (
                <div className="p-5 bg-[#00D4B3]/5 rounded-xl border border-[#00D4B3]/10">
                    <p className="text-sm font-semibold text-[#00D4B3] mb-2 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" /> 
                        Resultado Esperado
                    </p>
                    <p className="text-sm text-gray-300">{content.expected_outcome}</p>
                </div>
            )}
        </div>
    );
}

function VideoViewer({ content }: { content: VideoContent }) {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                {content.title && <h4 className="font-bold text-lg dark:text-white">{content.title}</h4>}
                {content.duration_estimate_minutes && (
                    <div className="flex items-center gap-2 text-xs text-[#00D4B3] px-3 py-1 bg-[#00D4B3]/10 rounded-full">
                        <Clock className="w-3 h-3" />
                        <span>{content.duration_estimate_minutes} min</span>
                    </div>
                )}
            </div>

            {/* Script Sections */}
            {content.script?.sections && (
                <div className="space-y-3">
                    <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider pl-1">Guión Técnico</h5>
                    {content.script.sections.map((section, i) => (
                        <div key={i} className="p-4 bg-[#131820] border border-white/5 rounded-xl text-sm hover:bg-[#1A1F29] transition-colors">
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-[10px] px-2 py-1 bg-[#0A2540] rounded text-[#00D4B3] font-medium border border-[#00D4B3]/20">{section.section_type}</span>
                                <span className="font-mono text-xs text-gray-500">{section.timecode_start} - {section.timecode_end}</span>
                            </div>
                            <p className="text-gray-200 leading-relaxed mb-3">{section.narration_text}</p>
                            {section.visual_notes && (
                                <div className="flex items-start gap-2 p-2 bg-[#000000]/20 rounded-lg border border-white/5">
                                    <span className="text-lg">🎬</span>
                                    <p className="text-xs text-gray-400 mt-0.5">{section.visual_notes}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}


            {/* Storyboard (collapsed by default for brevity) */}
            {content.storyboard && content.storyboard.length > 0 && (
                <details className="mt-2">
                    <summary className="text-sm font-medium cursor-pointer hover:text-blue-600 dark:text-gray-300 dark:hover:text-blue-400">
                        Ver Storyboard ({content.storyboard.length} tomas)
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-xs">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-white/5">
                                    <th className="p-2 text-left dark:text-gray-300">Toma</th>
                                    <th className="p-2 text-left dark:text-gray-300">Tiempo</th>
                                    <th className="p-2 text-left dark:text-gray-300">Visual</th>
                                    <th className="p-2 text-left dark:text-gray-300">Narración</th>
                                </tr>
                            </thead>
                            <tbody>
                                {content.storyboard.map((item, i) => (
                                    <tr key={i} className="border-t dark:border-white/10">
                                        <td className="p-2 dark:text-gray-300">{item.take_number}</td>
                                        <td className="p-2 whitespace-nowrap dark:text-gray-300">{item.timecode_start}-{item.timecode_end}</td>
                                        <td className="p-2 dark:text-gray-300">{item.visual_content}</td>
                                        <td className="p-2 dark:text-gray-300">{item.narration_text}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </details>
            )}
        </div>
    );
}
