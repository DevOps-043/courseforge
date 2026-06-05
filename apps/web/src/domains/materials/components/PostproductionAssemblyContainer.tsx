'use client';

import { useState, useEffect } from 'react';
import { useMaterials } from '../hooks/useMaterials';
import { assembleRemotionVideoAction } from '../actions/production.actions';
import { Loader2, Sparkles, CheckCircle2, Play, RefreshCw, Layers, Film } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PRODUCTION_THEME } from './production-asset-ui';

interface PostproductionAssemblyContainerProps {
    artifactId: string;
    onNext?: () => void;
    profile?: unknown;
}

interface TemplateOption {
    id: string;
    name: string;
    description: string;
    thumbnail: string;
}

const TEMPLATES: TemplateOption[] = [
    {
        id: 'split-screen-classic',
        name: 'Presentación + Avatar (Dividida)',
        description: 'Muestra las slides de Open Design al lado izquierdo y al avatar en la esquina derecha.',
        thumbnail: '🎨',
    },
    {
        id: 'full-presentation',
        name: 'Presentación Completa (Diapositivas)',
        description: 'Prioriza las diapositivas a pantalla completa con voz y música de fondo.',
        thumbnail: '📊',
    },
    {
        id: 'avatar-focus',
        name: 'Avatar Enfocado (Talking Head)',
        description: 'El avatar de Heygen ocupa el centro de la pantalla con soporte inferior de slides.',
        thumbnail: '👤',
    },
];

export function PostproductionAssemblyContainer({ artifactId, onNext }: PostproductionAssemblyContainerProps) {
    const router = useRouter();
    const { materials, getLessonComponents, refresh } = useMaterials(artifactId);
    const [selectedTemplate, setSelectedTemplate] = useState(TEMPLATES[0].id);
    const [isAssembling, setIsAssembling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [assemblyResult, setAssemblyResult] = useState<{ finalVideoUrl?: string; success: boolean } | null>(null);
    const [loadingComponents, setLoadingComponents] = useState(true);
    const [videoComponents, setVideoComponents] = useState<any[]>([]);

    useEffect(() => {
        const fetchVideoComponents = async () => {
            if (!materials?.lessons) return;
            setLoadingComponents(true);
            try {
                const allCompPromises = materials.lessons.map(async (l) => {
                    const comps = await getLessonComponents(l.id);
                    return comps.filter(c => c.type.includes('VIDEO'));
                });
                const results = await Promise.all(allCompPromises);
                setVideoComponents(results.flat());
            } catch (err) {
                console.error('Error fetching video components:', err);
            } finally {
                setLoadingComponents(false);
            }
        };
        fetchVideoComponents();
    }, [materials, getLessonComponents]);

    // Simulate assembly progress
    const handleAssemble = async () => {
        if (videoComponents.length === 0) return;
        setIsAssembling(true);
        setProgress(5);
        setAssemblyResult(null);

        // Progress animation
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 95) {
                    clearInterval(interval);
                    return 95;
                }
                return prev + Math.floor(Math.random() * 15) + 5;
            });
        }, 300);

        try {
            // Pick first video component for mockup assembly
            const componentId = videoComponents[0].id;
            
            const result = await assembleRemotionVideoAction(componentId, selectedTemplate, {
                template: selectedTemplate,
                videoComponentsCount: videoComponents.length,
            });

            clearInterval(interval);
            setProgress(100);

            if (result.success) {
                setAssemblyResult({ finalVideoUrl: result.finalVideoUrl, success: true });
                await refresh();
                router.refresh();
            } else {
                setAssemblyResult({ success: false });
                alert('Ocurrió un error al ensamblar: ' + result.error);
            }
        } catch (err) {
            clearInterval(interval);
            console.error(err);
            setAssemblyResult({ success: false });
        } finally {
            setIsAssembling(false);
        }
    };

    const hasRequiredAssets = videoComponents.length > 0;
    const isCompleted = videoComponents.some(c => c.assets?.production_status === 'COMPLETED');

    if (loadingComponents) {
        return (
            <div className={`flex flex-col items-center justify-center py-20 ${PRODUCTION_THEME.panel}`}>
                <Loader2 className="animate-spin text-[#1F5AF6] mb-4" size={32} />
                <p className={`font-medium ${PRODUCTION_THEME.secondaryText}`}>Cargando estado de assets de video...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="rounded-2xl border border-gray-200 bg-gradient-to-r from-white to-purple-50 p-6 dark:border-[#6C757D]/10 dark:from-[#151A21] dark:to-purple-500/10 shadow-sm">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-xl font-bold mb-2 flex items-center gap-3 text-gray-900 dark:text-white">
                            <Film className="text-purple-500" size={24} />
                            Fase 7: Postproducción (Ensamblado Remotion)
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">
                            Unifica tus diapositivas de Open Design, locución de voz, avatar y pistas musicales en un único video final renderizado de forma automatizada mediante Remotion.
                        </p>
                    </div>
                    {isCompleted && (
                        <div className="flex items-center gap-2 rounded-full bg-green-500/15 border border-green-500/30 px-4 py-1.5 text-xs font-semibold text-green-600 dark:text-green-400">
                            <CheckCircle2 size={14} />
                            Video Ensamblado
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Configuration / Assembly triggers */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Template selection */}
                    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 space-y-4 shadow-sm">
                        <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Layers className="text-[#1F5AF6]" size={18} />
                            Selecciona una Plantilla de Ensamble
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {TEMPLATES.map((tpl) => (
                                <button
                                    key={tpl.id}
                                    onClick={() => setSelectedTemplate(tpl.id)}
                                    disabled={isAssembling}
                                    className={`flex flex-col text-left p-4 rounded-xl border transition-all hover:bg-gray-50 dark:hover:bg-white/5 ${
                                        selectedTemplate === tpl.id
                                            ? 'border-purple-500 bg-purple-500/5 ring-1 ring-purple-500/30'
                                            : 'border-gray-200 dark:border-[#6C757D]/10 bg-transparent'
                                    }`}
                                >
                                    <span className="text-2xl mb-2">{tpl.thumbnail}</span>
                                    <span className="font-semibold text-sm text-gray-900 dark:text-white mb-1">{tpl.name}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{tpl.description}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Remotion Assembly Panel */}
                    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 space-y-6 shadow-sm">
                        <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Sparkles className="text-yellow-500" size={18} />
                            Motor de Render Remotion
                        </h3>

                        {!hasRequiredAssets ? (
                            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-sm">
                                No se encontraron videos ni demostraciones que requieran ensamblado en esta lección.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-300">
                                    El motor de Remotion compilará {videoComponents.length} componente(s) de video aplicando la plantilla elegida, inyectando las locuciones y unificando el B-roll correspondiente.
                                </p>

                                {isAssembling ? (
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="text-purple-600 dark:text-purple-400 font-semibold flex items-center gap-1.5 animate-pulse">
                                                <Loader2 className="animate-spin" size={12} />
                                                Ensamblando assets con Remotion...
                                            </span>
                                            <span className="font-bold text-gray-900 dark:text-white">{progress}%</span>
                                        </div>
                                        <div className="relative h-2.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                                            <div
                                                className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-300"
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-4">
                                        <button
                                            onClick={handleAssemble}
                                            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-lg shadow-purple-500/25 transition-all active:scale-[0.98]"
                                        >
                                            <RefreshCw className="w-4 h-4" />
                                            Iniciar Ensamblado
                                        </button>

                                        {onNext && isCompleted && (
                                            <button
                                                onClick={onNext}
                                                className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-green-600 hover:bg-green-500 text-white transition-all shadow-lg shadow-green-500/25"
                                            >
                                                Avanzar a Publicación
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Preview / Results */}
                <div className="space-y-6">
                    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 space-y-4 shadow-sm flex flex-col min-h-[300px]">
                        <h3 className="text-md font-bold text-gray-900 dark:text-white flex items-center gap-2">
                            <Play className="text-purple-500" size={18} />
                            Previsualización
                        </h3>

                        {isCompleted || (assemblyResult && assemblyResult.success) ? (
                            <div className="flex-1 flex flex-col justify-between space-y-4">
                                <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-inner group">
                                    <video
                                        src={assemblyResult?.finalVideoUrl || videoComponents[0]?.assets?.final_video_url}
                                        controls
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                    Video pre-visualizable en formato de prueba (1080p). Listo para envío final.
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-8 text-center bg-gray-50/50 dark:bg-[#0F1419]/30">
                                <Film className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
                                <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    El reproductor de preview estará disponible tras compilar el video con Remotion.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
