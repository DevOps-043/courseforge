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
    className?: string;
}

export function ComponentViewer({ component, className = '' }: ComponentViewerProps) {
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

    return (
        <div className={`border rounded-lg overflow-hidden ${className}`}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
                <div className="flex items-center gap-2">
                    {getIcon(component.type)}
                    <span className="font-medium text-sm">{getLabel(component.type)}</span>
                </div>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>

            {expanded && (
                <div className="p-4 bg-white">
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
            {content.title && <h4 className="font-semibold">{content.title}</h4>}
            {content.introduction && <p className="text-sm text-gray-600 italic">{content.introduction}</p>}

            <div className="space-y-2">
                {content.scenes?.map((scene, i) => (
                    <div key={i} className={`flex gap-2 ${scene.character === 'Usuario' ? 'flex-row-reverse' : ''}`}>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${scene.character === 'Lia' ? 'bg-blue-100' :
                                scene.character === 'Usuario' ? 'bg-green-100' : 'bg-gray-100'
                            }`}>
                            {scene.character === 'Lia' ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
                        </div>
                        <div className={`max-w-[80%] p-3 rounded-lg ${scene.character === 'Usuario' ? 'bg-green-50' : 'bg-gray-100'
                            }`}>
                            <p className="text-xs text-gray-500 mb-1">{scene.character}</p>
                            <p className="text-sm">{scene.message}</p>
                        </div>
                    </div>
                ))}
            </div>

            {content.reflection_prompt && (
                <div className="mt-4 p-3 bg-yellow-50 rounded-lg">
                    <p className="text-sm font-medium text-yellow-800">Reflexión:</p>
                    <p className="text-sm text-yellow-700">{content.reflection_prompt}</p>
                </div>
            )}
        </div>
    );
}

function ReadingViewer({ content }: { content: ReadingContent }) {
    return (
        <div className="space-y-4">
            {content.title && <h4 className="font-semibold text-lg">{content.title}</h4>}

            {content.body_html && (
                <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: content.body_html }}
                />
            )}

            {content.key_points && content.key_points.length > 0 && (
                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-800 mb-2">Puntos Clave:</p>
                    <ul className="list-disc list-inside text-sm text-blue-700 space-y-1">
                        {content.key_points.map((point, i) => (
                            <li key={i}>{point}</li>
                        ))}
                    </ul>
                </div>
            )}

            {content.reflection_question && (
                <div className="p-3 bg-yellow-50 rounded-lg">
                    <p className="text-sm font-medium text-yellow-800">Pregunta de Reflexión:</p>
                    <p className="text-sm text-yellow-700">{content.reflection_question}</p>
                </div>
            )}

            {content.estimated_reading_time_min && (
                <p className="text-xs text-gray-500">
                    Tiempo estimado de lectura: {content.estimated_reading_time_min} min
                </p>
            )}
        </div>
    );
}

function QuizViewer({ content }: { content: QuizContent }) {
    return (
        <div className="space-y-4">
            {content.title && <h4 className="font-semibold">{content.title}</h4>}
            {content.instructions && <p className="text-sm text-gray-600">{content.instructions}</p>}

            <div className="space-y-4">
                {content.items?.map((item, i) => (
                    <div key={i} className="p-3 border rounded-lg">
                        <div className="flex items-start gap-2 mb-2">
                            <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-xs font-medium">
                                {i + 1}
                            </span>
                            <p className="text-sm font-medium">{item.question}</p>
                        </div>

                        <div className="flex gap-2 text-xs text-gray-500 mb-2">
                            <span className="px-2 py-0.5 bg-gray-100 rounded">{item.type}</span>
                            <span className="px-2 py-0.5 bg-gray-100 rounded">{item.difficulty}</span>
                        </div>

                        {item.options && (
                            <div className="space-y-1 ml-8">
                                {item.options.map((opt, j) => (
                                    <div
                                        key={j}
                                        className={`text-sm p-2 rounded ${j === item.correct_answer || opt === item.correct_answer
                                                ? 'bg-green-50 border border-green-200'
                                                : 'bg-gray-50'
                                            }`}
                                    >
                                        {opt}
                                    </div>
                                ))}
                            </div>
                        )}

                        {item.explanation && (
                            <div className="mt-2 ml-8 p-2 bg-yellow-50 rounded text-xs text-yellow-800">
                                <strong>Explicación:</strong> {item.explanation}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <p className="text-sm text-gray-600">
                Puntaje mínimo para aprobar: <strong>{content.passing_score}%</strong>
            </p>
        </div>
    );
}

function DemoGuideViewer({ content }: { content: DemoGuideContent }) {
    return (
        <div className="space-y-4">
            {content.title && <h4 className="font-semibold">{content.title}</h4>}
            {content.objective && <p className="text-sm text-gray-600">{content.objective}</p>}

            {content.prerequisites && content.prerequisites.length > 0 && (
                <div className="p-3 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium mb-1">Prerrequisitos:</p>
                    <ul className="list-disc list-inside text-sm text-gray-600">
                        {content.prerequisites.map((p, i) => (
                            <li key={i}>{p}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="space-y-2">
                {content.steps?.map((step, i) => (
                    <div key={i} className="flex gap-3 p-3 border rounded-lg">
                        <span className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-medium">
                            {step.step_number}
                        </span>
                        <div className="flex-1">
                            <p className="text-sm">{step.instruction}</p>
                            {step.tip && (
                                <p className="text-xs text-blue-600 mt-1">💡 {step.tip}</p>
                            )}
                            {step.warning && (
                                <p className="text-xs text-orange-600 mt-1">⚠️ {step.warning}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {content.summary && (
                <div className="p-3 bg-green-50 rounded-lg">
                    <p className="text-sm font-medium text-green-800">Resumen:</p>
                    <p className="text-sm text-green-700">{content.summary}</p>
                </div>
            )}
        </div>
    );
}

function ExerciseViewer({ content }: { content: ExerciseContent }) {
    return (
        <div className="space-y-4">
            {content.title && <h4 className="font-semibold">{content.title}</h4>}

            {content.body_html && (
                <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: content.body_html }}
                />
            )}

            {content.instructions && (
                <div className="p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">Instrucciones:</p>
                    <p className="text-sm text-blue-700">{content.instructions}</p>
                </div>
            )}

            {content.expected_outcome && (
                <div className="p-3 bg-green-50 rounded-lg">
                    <p className="text-sm font-medium text-green-800">Resultado esperado:</p>
                    <p className="text-sm text-green-700">{content.expected_outcome}</p>
                </div>
            )}
        </div>
    );
}

function VideoViewer({ content }: { content: VideoContent }) {
    return (
        <div className="space-y-4">
            {content.title && <h4 className="font-semibold">{content.title}</h4>}
            {content.duration_estimate_minutes && (
                <p className="text-sm text-gray-500">Duración estimada: {content.duration_estimate_minutes} min</p>
            )}

            {/* Script Sections */}
            {content.script?.sections && (
                <div className="space-y-2">
                    <h5 className="text-sm font-medium">Guión:</h5>
                    {content.script.sections.map((section, i) => (
                        <div key={i} className="p-3 border rounded-lg text-sm">
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{section.section_type}</span>
                                <span className="text-xs text-gray-500">{section.timecode_start} - {section.timecode_end}</span>
                            </div>
                            <p>{section.narration_text}</p>
                            {section.visual_notes && (
                                <p className="text-xs text-gray-500 mt-1">🎬 {section.visual_notes}</p>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Storyboard (collapsed by default for brevity) */}
            {content.storyboard && content.storyboard.length > 0 && (
                <details className="mt-2">
                    <summary className="text-sm font-medium cursor-pointer hover:text-blue-600">
                        Ver Storyboard ({content.storyboard.length} tomas)
                    </summary>
                    <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-xs">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="p-2 text-left">Toma</th>
                                    <th className="p-2 text-left">Tiempo</th>
                                    <th className="p-2 text-left">Visual</th>
                                    <th className="p-2 text-left">Narración</th>
                                </tr>
                            </thead>
                            <tbody>
                                {content.storyboard.map((item, i) => (
                                    <tr key={i} className="border-t">
                                        <td className="p-2">{item.take_number}</td>
                                        <td className="p-2 whitespace-nowrap">{item.timecode_start}-{item.timecode_end}</td>
                                        <td className="p-2">{item.visual_content}</td>
                                        <td className="p-2">{item.narration_text}</td>
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
