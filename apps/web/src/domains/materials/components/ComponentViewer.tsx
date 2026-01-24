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
    Download,
    ExternalLink,
    Maximize2,
    Sparkles,
    CheckCircle,
    Clock,
    AlertTriangle,
    User,
    Bot,
    Clapperboard,
    FileText,
    MonitorPlay,
    Lightbulb,
    ChevronRight,
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
            EXERCISE: <FileText className="h-4 w-4" />,
            VIDEO_THEORETICAL: <MonitorPlay className="h-4 w-4" />,
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
                return <DialogueViewer content={component.content as unknown as DialogueContent} />;
            case 'READING':
                return <ReadingViewer content={component.content as unknown as ReadingContent} />;
            case 'QUIZ':
                return <QuizViewer content={component.content as unknown as QuizContent} />;
            case 'DEMO_GUIDE':
                return <DemoGuideViewer content={component.content as unknown as DemoGuideContent} />;
            case 'EXERCISE':
                return <ExerciseViewer content={component.content as unknown as ExerciseContent} />;
            case 'VIDEO_THEORETICAL':
            case 'VIDEO_DEMO':
            case 'VIDEO_GUIDE':
                return <VideoViewer content={component.content as unknown as VideoContent} />;
            default:
                return <pre className="text-xs overflow-auto text-gray-700 dark:text-gray-300">{JSON.stringify(component.content, null, 2)}</pre>;
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
        <div className={`border border-gray-200 dark:border-white/10 rounded-lg overflow-hidden ${className}`}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                title={getLabel(component.type)}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div className="flex-shrink-0 text-gray-500 dark:text-gray-400">
                        {getIcon(component.type)}
                    </div>
                    <span className="font-medium text-sm text-gray-900 dark:text-white truncate">{getLabel(component.type)}</span>
                </div>
                <div className="flex-shrink-0 ml-2">
                    {expanded ? <ChevronUp className="h-4 w-4 text-gray-500 dark:text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-500 dark:text-gray-400" />}
                </div>
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
        <div className="space-y-4">
            {content.title && <h4 className="font-semibold text-gray-900 dark:text-white text-lg">{content.title}</h4>}
            {content.introduction && <p className="text-sm text-gray-600 dark:text-gray-400 italic bg-gray-50 dark:bg-white/5 p-3 rounded-lg border border-gray-100 dark:border-white/5">{content.introduction}</p>}

            <div className="space-y-4 mt-4">
                {content.scenes?.map((scene, i) => (
                    <div key={i} className={`flex gap-3 ${scene.character === 'Usuario' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0 ${
                            scene.character === 'Lia' 
                                ? 'bg-[#00D4B3] text-[#0A2540]' 
                                : scene.character === 'Usuario' 
                                    ? 'bg-[#0A2540] text-white' 
                                    : 'bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-gray-300'
                            }`}>
                            {scene.character === 'Lia' ? <Bot className="h-5 w-5" /> : <User className="h-4 w-4" />}
                        </div>
                        <div className={`max-w-[85%] p-4 rounded-2xl text-sm shadow-sm ${
                            scene.character === 'Usuario' 
                                ? 'bg-[#0A2540] text-gray-100 rounded-tr-sm' 
                                : 'bg-gray-100 dark:bg-[#2C323C] text-gray-800 dark:text-gray-200 rounded-tl-sm'
                            }`}>
                            <p className="text-[10px] font-bold mb-1 opacity-70 uppercase tracking-wider">{scene.character}</p>
                            <p className="leading-relaxed whitespace-pre-wrap">{scene.message}</p>
                        </div>
                    </div>
                ))}
            </div>

            {content.reflection_prompt && (
                <div className="mt-6 p-4 bg-amber-50 dark:bg-[#F59E0B]/10 border border-amber-200 dark:border-[#F59E0B]/20 rounded-xl">
                    <p className="text-sm font-bold text-amber-600 dark:text-[#F59E0B] mb-2 flex items-center gap-2">
                        <Sparkles className="w-4 h-4" /> Reflexión
                    </p>
                    <p className="text-sm text-amber-800 dark:text-[#F59E0B]/90 leading-relaxed">{content.reflection_prompt}</p>
                </div>
            )}
        </div>
    );
}

function ReadingViewer({ content }: { content: ReadingContent }) {
    return (
        <div className="space-y-6">
            <div className="space-y-2">
                {content.title && <h4 className="font-bold text-2xl text-gray-900 dark:text-white">{content.title}</h4>}
                
                {content.estimated_reading_time_min && (
                    <div className="inline-flex items-center gap-2 text-xs font-medium text-[#00D4B3] bg-[#00D4B3]/10 px-2.5 py-1 rounded-full">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{content.estimated_reading_time_min} min lectura</span>
                    </div>
                )}
            </div>

            {content.body_html && (
                <div
                    className="prose prose-sm md:prose-base dark:prose-invert max-w-none text-gray-700 dark:text-gray-300
                    prose-headings:text-gray-900 dark:prose-headings:text-white 
                    prose-strong:text-gray-900 dark:prose-strong:text-white 
                    prose-a:text-[#00D4B3] hover:prose-a:text-[#00D4B3]/80
                    prose-code:bg-gray-100 dark:prose-code:bg-white/10 prose-code:px-1 prose-code:rounded prose-code:text-[#1F5AF6] dark:prose-code:text-[#58A6FF]"
                    dangerouslySetInnerHTML={{ __html: content.body_html }}
                />
            )}

            {content.key_points && content.key_points.length > 0 && (
                <div className="p-5 bg-blue-50 dark:bg-[#0A2540]/30 border border-blue-100 dark:border-[#0A2540] rounded-xl shadow-sm">
                    <p className="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#00D4B3]" />
                        Puntos Clave
                    </p>
                    <ul className="space-y-3">
                        {content.key_points.map((point, i) => (
                            <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-start gap-3">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#00D4B3] mt-2 flex-shrink-0 shadow-sm" />
                                <span className="leading-relaxed">{point}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {content.reflection_question && (
                <div className="p-5 bg-gradient-to-r from-gray-50 to-white dark:from-[#0A2540] dark:to-[#1E2329] border-l-4 border-[#00D4B3] rounded-r-xl shadow-sm">
                    <p className="text-xs font-bold uppercase tracking-wider text-[#00D4B3] mb-2">Pregunta de Reflexión</p>
                    <p className="text-base font-medium text-gray-800 dark:text-white italic">"{content.reflection_question}"</p>
                </div>
            )}
        </div>
    );
}

function QuizViewer({ content }: { content: QuizContent }) {
    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-white/5">
                {content.title && <h4 className="font-bold text-xl text-gray-900 dark:text-white">{content.title}</h4>}
                <div className="px-3 py-1 bg-gray-100 dark:bg-[#1E2329] rounded-full border border-gray-200 dark:border-white/10 text-xs text-gray-500 dark:text-gray-400 font-medium">
                    Puntaje min: <span className="text-gray-900 dark:text-white font-bold ml-1">{content.passing_score}%</span>
                </div>
            </div>
            
            {content.instructions && <p className="text-sm text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-100 dark:border-blue-900/20">{content.instructions}</p>}

            <div className="space-y-6">
                {content.items?.map((item, i) => (
                    <div key={i} className="p-6 bg-white dark:bg-[#131820] border border-gray-200 dark:border-white/5 rounded-2xl shadow-sm transition-all hover:shadow-md hover:border-gray-300 dark:hover:border-white/10">
                        <div className="flex gap-4 mb-6">
                            <span className="flex-shrink-0 w-8 h-8 bg-[#00D4B3]/10 text-[#00D4B3] rounded-lg flex items-center justify-center text-sm font-bold border border-[#00D4B3]/20">
                                {i + 1}
                            </span>
                            <div className="flex-1">
                                <p className="text-base font-semibold text-gray-900 dark:text-white mb-2 leading-relaxed">{item.question}</p>
                                <div className="flex gap-2">
                                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-white/5 rounded text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide border border-gray-200 dark:border-transparent">{item.type}</span>
                                    <span className="px-2 py-0.5 bg-gray-100 dark:bg-white/5 rounded text-[10px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-wide border border-gray-200 dark:border-transparent">{item.difficulty}</span>
                                </div>
                            </div>
                        </div>

                        {item.options && (
                            <div className="space-y-3 pl-0 md:pl-12">
                                {item.options.map((opt, j) => {
                                    const isCorrect = j === item.correct_answer || opt === item.correct_answer;
                                    return (
                                        <div
                                            key={j}
                                            className={`p-3.5 rounded-xl border flex items-center gap-3 transition-colors ${
                                                isCorrect
                                                    ? 'bg-emerald-50 dark:bg-[#00D4B3]/10 border-emerald-200 dark:border-[#00D4B3]/50'
                                                    : 'bg-gray-50 dark:bg-[#0F1419] border-gray-100 dark:border-white/5 text-gray-600 dark:text-gray-400'
                                            }`}
                                        >
                                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                                isCorrect ? 'border-emerald-500 dark:border-[#00D4B3] bg-emerald-500 dark:bg-[#00D4B3]' : 'border-gray-300 dark:border-gray-600'
                                            }`}>
                                                {isCorrect && <CheckCircle className="w-3.5 h-3.5 text-white dark:text-[#0A2540]" />}
                                            </div>
                                            <span className={`text-sm ${isCorrect ? 'text-gray-900 dark:text-white font-medium' : ''}`}>{opt}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {item.explanation && (
                            <div className="mt-5 md:ml-12 p-4 bg-amber-50 dark:bg-[#F59E0B]/10 border border-amber-200 dark:border-[#F59E0B]/20 rounded-xl flex gap-3">
                                <Lightbulb className="w-5 h-5 text-amber-500 dark:text-[#F59E0B] flex-shrink-0 mt-0.5" />
                                <div className="text-sm text-amber-800 dark:text-[#F59E0B]/90">
                                    <span className="font-bold text-amber-600 dark:text-[#F59E0B] block mb-1">Explicación</span>
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
            <div className="border-l-4 border-[#00D4B3] pl-4">
                 {content.title && <h4 className="font-bold text-xl text-gray-900 dark:text-white mb-2">{content.title}</h4>}
                 {content.objective && <p className="text-sm text-gray-600 dark:text-gray-400 italic">{content.objective}</p>}
            </div>

            {content.prerequisites && content.prerequisites.length > 0 && (
                <div className="p-5 bg-gray-50 dark:bg-[#1E2329] border border-gray-200 dark:border-white/5 rounded-xl">
                    <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Prerrequisitos</p>
                    <ul className="space-y-2">
                        {content.prerequisites.map((p, i) => (
                            <li key={i} className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
                                <div className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" />
                                {p}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="space-y-4">
                {content.steps?.map((step, i) => (
                    <div key={i} className="group relative flex gap-4 p-5 bg-white dark:bg-[#131820] border border-gray-200 dark:border-white/5 rounded-xl transition-all hover:border-gray-300 dark:hover:border-white/10 shadow-sm">
                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-[#0A2540] text-white rounded-lg border border-white/5 text-sm font-bold shadow-md">
                            {step.step_number}
                        </div>
                        <div className="flex-1">
                            <p className="text-sm text-gray-900 dark:text-gray-200 font-medium mb-2">{step.instruction}</p>
                            {step.tip && (
                                <p className="text-xs text-emerald-600 dark:text-[#00D4B3] flex items-center gap-1.5 mt-2 bg-emerald-50 dark:bg-[#00D4B3]/5 p-2 rounded-lg w-fit">
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span className="font-medium">Tip:</span> {step.tip}
                                </p>
                            )}
                            {step.warning && (
                                <p className="text-xs text-amber-600 dark:text-[#F59E0B] flex items-center gap-1.5 mt-2 bg-amber-50 dark:bg-[#F59E0B]/5 p-2 rounded-lg w-fit">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    <span className="font-medium">Atención:</span> {step.warning}
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {content.summary && (
                <div className="p-5 bg-blue-50 dark:bg-[#0A2540]/30 border border-blue-100 dark:border-[#00D4B3]/30 rounded-xl relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-[#00D4B3]" />
                    <p className="text-sm font-bold text-[#00D4B3] mb-1">Resumen</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{content.summary}</p>
                </div>
            )}
        </div>
    );
}

function ExerciseViewer({ content }: { content: ExerciseContent }) {
    return (
        <div className="space-y-6">
            {content.title && <h4 className="font-bold text-xl text-gray-900 dark:text-white border-b border-gray-100 dark:border-white/5 pb-4">{content.title}</h4>}

            {content.body_html && (
                <div
                    className="prose prose-sm dark:prose-invert max-w-none text-gray-700 dark:text-gray-300"
                    dangerouslySetInnerHTML={{ __html: content.body_html }}
                />
            )}

            {content.instructions && (
                <div className="p-6 bg-slate-50 dark:bg-[#0A2540]/20 rounded-xl border border-slate-200 dark:border-white/5 shadow-sm">
                    <p className="text-sm font-bold text-slate-700 dark:text-white mb-3 flex items-center gap-2">
                        <ListOrdered className="w-4 h-4 text-[#00D4B3]" /> 
                        Instrucciones
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{content.instructions}</p>
                </div>
            )}

            {content.expected_outcome && (
                <div className="p-6 bg-emerald-50 dark:bg-[#00D4B3]/5 rounded-xl border border-emerald-100 dark:border-[#00D4B3]/10">
                    <p className="text-sm font-bold text-emerald-700 dark:text-[#00D4B3] mb-3 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" /> 
                        Resultado Esperado
                    </p>
                    <p className="text-sm text-emerald-900 dark:text-gray-300">{content.expected_outcome}</p>
                </div>
            )}
        </div>
    );
}

function VideoViewer({ content }: { content: VideoContent }) {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                {content.title && <h4 className="font-bold text-lg text-gray-900 dark:text-white">{content.title}</h4>}
                {content.duration_estimate_minutes && (
                    <div className="flex items-center gap-2 text-xs font-bold text-[#00D4B3] px-3 py-1.5 bg-[#00D4B3]/10 rounded-full border border-[#00D4B3]/20">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{content.duration_estimate_minutes} min</span>
                    </div>
                )}
            </div>

            {/* Script Sections */}
            {content.script?.sections && (
                <div className="space-y-4">
                    <h5 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider pl-1">Guión Técnico</h5>
                    {content.script.sections.map((section, i) => (
                        <div key={i} className="p-5 bg-white dark:bg-[#131820] border border-gray-200 dark:border-white/5 rounded-xl text-sm hover:border-gray-300 dark:hover:border-white/10 transition-colors shadow-sm">
                            <div className="flex justify-between items-center mb-3">
                                <span className="text-[10px] px-2 py-1 bg-[#1F5AF6]/10 text-[#1F5AF6] rounded font-bold border border-[#1F5AF6]/20 uppercase tracking-wide">{section.section_type}</span>
                                <span className="font-mono text-xs text-gray-400 dark:text-gray-500">{section.timecode_start} - {section.timecode_end}</span>
                            </div>
                            <p className="text-gray-700 dark:text-gray-200 leading-relaxed mb-4">{section.narration_text}</p>
                            {section.visual_notes && (
                                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-[#000000]/20 rounded-lg border border-gray-100 dark:border-white/5">
                                    <Clapperboard className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-gray-600 dark:text-gray-400 leading-snug">{section.visual_notes}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}


            {/* Storyboard (collapsed by default for brevity) */}
            {content.storyboard && content.storyboard.length > 0 && (
                <details className="mt-4 group">
                    <summary className="text-sm font-semibold cursor-pointer text-gray-600 dark:text-gray-300 hover:text-[#00D4B3] dark:hover:text-[#00D4B3] flex items-center gap-2 select-none">
                        <ChevronRight className="w-4 h-4 transition-transform group-open:rotate-90" />
                        Ver Storyboard ({content.storyboard.length} tomas)
                    </summary>
                    <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#151A21]">
                        <table className="min-w-full text-xs">
                            <thead>
                                <tr className="bg-gray-50 dark:bg-white/5 border-b border-gray-200 dark:border-white/5">
                                    <th className="p-3 text-left font-bold text-gray-700 dark:text-gray-200">Toma</th>
                                    <th className="p-3 text-left font-bold text-gray-700 dark:text-gray-200">Tiempo</th>
                                    <th className="p-3 text-left font-bold text-gray-700 dark:text-gray-200">Visual</th>
                                    <th className="p-3 text-left font-bold text-gray-700 dark:text-gray-200">Narración</th>
                                </tr>
                            </thead>
                            <tbody>
                                {content.storyboard.map((item, i) => (
                                    <tr key={i} className="border-b border-gray-100 dark:border-white/5 last:border-0 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                                        <td className="p-3 font-medium text-gray-900 dark:text-gray-300">{item.take_number}</td>
                                        <td className="p-3 whitespace-nowrap text-gray-500 dark:text-gray-400 font-mono">{item.timecode_start}-{item.timecode_end}</td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300 max-w-[200px]">{item.visual_content}</td>
                                        <td className="p-3 text-gray-600 dark:text-gray-300 max-w-[200px]">{item.narration_text}</td>
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
