'use client';

import { useState, useEffect, useRef } from 'react';
import { useMaterials } from '../hooks/useMaterials';
import {
    assembleRemotionVideoAction,
    getRemotionJobStatusAction,
    completeRemotionAssemblyAction
} from '../actions/production.actions';
import { Loader2, Sparkles, CheckCircle2, Play, RefreshCw, Layers, Film } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { PRODUCTION_THEME } from './production-asset-ui';
import { getTemplatesAction, type RemotionTemplate } from '@/domains/production/actions/templates.actions';
import { RemotionPreviewPlayer } from './RemotionPreviewPlayer';
import { hasPreviewableAssets } from '@/remotion/buildAssemblyProps';

interface PostproductionAssemblyContainerProps {
    artifactId: string;
    onNext?: () => void;
    profile?: unknown;
}

export function PostproductionAssemblyContainer({ artifactId, onNext }: PostproductionAssemblyContainerProps) {
    const router = useRouter();
    const { materials, getLessonComponents, refresh } = useMaterials(artifactId);
    const [templates, setTemplates] = useState<RemotionTemplate[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<string>('');
    const [isAssembling, setIsAssembling] = useState(false);
    const [progress, setProgress] = useState(0);
    const [loadingComponents, setLoadingComponents] = useState(true);
    const [loadingTemplates, setLoadingTemplates] = useState(true);
    const [videoComponents, setVideoComponents] = useState<any[]>([]);
    const [activePreviewId, setActivePreviewId] = useState<string>('');
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Limpia el polling de estado si el componente se desmonta a mitad del render.
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (videoComponents.length > 0 && !activePreviewId) {
            const firstWithVideo = videoComponents.find(c => c.assets?.final_video_url);
            if (firstWithVideo) {
                setActivePreviewId(firstWithVideo.id);
            } else {
                setActivePreviewId(videoComponents[0].id);
            }
        }
    }, [videoComponents, activePreviewId]);

    useEffect(() => {
        const fetchTemplates = async () => {
            setLoadingTemplates(true);
            try {
                const result = await getTemplatesAction();
                if (result.success && result.templates) {
                    setTemplates(result.templates);
                    if (result.templates.length > 0) {
                        setSelectedTemplate(result.templates[0].id);
                    }
                }
            } catch (err) {
                console.error('Error fetching templates:', err);
            } finally {
                setLoadingTemplates(false);
            }
        };
        fetchTemplates();
    }, []);

    useEffect(() => {
        const fetchVideoComponents = async () => {
            if (!materials?.lessons) return;
            setLoadingComponents(true);
            try {
                const allCompPromises = materials.lessons.map(async (l) => {
                    const comps = await getLessonComponents(l.id);
                    return comps.filter(c => c.type.includes('VIDEO')).map(c => ({
                        ...c,
                        lessonTitle: l.lesson_title
                    }));
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

    // Real assembly progress using Express API polling
    const handleAssemble = async () => {
        if (componentsToAssemble.length === 0) return;
        setIsAssembling(true);
        setProgress(0);

        try {
            // Pick first video component that requires assembly
            const componentId = componentsToAssemble[0].id;
            
            const triggerResult = await assembleRemotionVideoAction(componentId, selectedTemplate, {
                template: selectedTemplate,
                videoComponentsCount: componentsToAssemble.length,
            });

            if (!triggerResult.success || !triggerResult.jobId) {
                setIsAssembling(false);
                alert('Ocurrió un error al iniciar el ensamblado: ' + (triggerResult.error || 'Error desconocido'));
                return;
            }

            const jobId = triggerResult.jobId;
            setProgress(5); // Started

            // Poll the job status every 1500ms
            const stopPolling = () => {
                if (pollIntervalRef.current) {
                    clearInterval(pollIntervalRef.current);
                    pollIntervalRef.current = null;
                }
            };
            const pollInterval = setInterval(async () => {
                try {
                    const statusResult = await getRemotionJobStatusAction(jobId);
                    if (!statusResult.success || !statusResult.job) {
                        console.error('Error polling status:', statusResult.error);
                        return;
                    }

                    const job = statusResult.job;
                    
                    // Extract progress percent from array if present
                    if (Array.isArray(job.progress) && job.progress.length > 0) {
                        const lastProgress = job.progress[job.progress.length - 1];
                        if (typeof lastProgress?.percent === 'number') {
                            setProgress(lastProgress.percent);
                        }
                    }

                    if (job.status === 'SUCCEEDED') {
                        stopPolling();
                        setProgress(100);
                        const finalVideoUrl = job.output_snapshot?.final_video_url || '';
                        
                        // Sync downstream pipeline events and publication requests
                        await completeRemotionAssemblyAction(componentId, finalVideoUrl);
                        
                        await refresh();
                        router.refresh();
                        setIsAssembling(false);
                    } else if (job.status === 'FAILED') {
                        stopPolling();
                        setIsAssembling(false);
                        const errorMsg = job.provider_error?.message || 'Error desconocido durante la renderización';
                        alert('Error al ensamblar: ' + errorMsg);
                    } else if (job.status === 'CANCELLED') {
                        stopPolling();
                        setIsAssembling(false);
                        alert('El ensamblado fue cancelado.');
                    }
                } catch (pollErr) {
                    console.error('Error in polling loop:', pollErr);
                }
            }, 1500);
            pollIntervalRef.current = pollInterval;

        } catch (err) {
            console.error(err);
            setIsAssembling(false);
        }
    };

    const componentsToAssemble = videoComponents.filter(c => !c.assets?.final_video_url);
    const selectedTemplateSlug =
        templates.find(t => t.id === selectedTemplate)?.composition_id ?? null;
    const hasRequiredAssets = videoComponents.length > 0;
    const hasComponentsToAssemble = componentsToAssemble.length > 0;
    const isCompleted = videoComponents.length > 0 && componentsToAssemble.length === 0;

    if (loadingComponents || loadingTemplates) {
        return (
            <div className={`flex flex-col items-center justify-center py-20 ${PRODUCTION_THEME.panel}`}>
                <Loader2 className="animate-spin text-[#1F5AF6] mb-4" size={32} />
                <p className={`font-medium ${PRODUCTION_THEME.secondaryText}`}>Cargando datos del ensamblado...</p>
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
                            {templates.map((tpl) => (
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
                                    <span className="text-2xl mb-2">{tpl.thumbnail_url || '🎨'}</span>
                                    <span className="font-semibold text-sm text-gray-900 dark:text-white mb-1">{tpl.name}</span>
                                    <span className="text-xs text-gray-500 dark:text-gray-400 leading-snug">{tpl.description}</span>
                                </button>
                            ))}
                            {templates.length === 0 && (
                                <div className="col-span-3 text-center py-4 text-sm text-gray-500">
                                    No hay plantillas disponibles. Sube una en el Panel Administrativo.
                                </div>
                            )}
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
                                No se encontraron videos ni demostraciones en esta lección.
                            </div>
                        ) : !hasComponentsToAssemble ? (
                            <div className="space-y-4">
                                <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm">
                                    Todos los videos del curso ya cuentan con un video final (subido o vinculado) en la Fase 6. No es necesario realizar el ensamblado por Remotion.
                                </div>
                                {onNext && (
                                    <button
                                        onClick={onNext}
                                        className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-green-600 hover:bg-green-500 text-white transition-all shadow-lg shadow-green-500/25"
                                    >
                                        Avanzar a Publicación
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <p className="text-sm text-gray-600 dark:text-gray-300">
                                    El motor de Remotion compilará {componentsToAssemble.length} de {videoComponents.length} componente(s) de video (aquellos sin video final) aplicando la plantilla elegida, inyectando las locuciones y unificando el B-roll correspondiente.
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

                        {videoComponents.length > 1 && (
                            <div className="space-y-1.5 mb-2">
                                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                    Seleccionar Video para Preview:
                                </label>
                                <select
                                    value={activePreviewId}
                                    onChange={(e) => setActivePreviewId(e.target.value)}
                                    className="w-full text-sm rounded-xl border border-gray-200 bg-white p-2 dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
                                >
                                    {videoComponents.map((c, idx) => (
                                        <option key={c.id} value={c.id}>
                                            {c.lessonTitle || `Lección ${idx + 1}`} - {(c.content as any)?.title || 'Video'} ({c.assets?.final_video_url ? 'Disponible' : 'Sin Video'})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {(() => {
                            const activePreview = videoComponents.find(c => c.id === activePreviewId) || videoComponents[0];
                            const previewUrl = activePreview?.assets?.final_video_url;

                            if (previewUrl) {
                                return (
                                    <div className="flex-1 flex flex-col justify-between space-y-4">
                                        <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-inner group">
                                            <video
                                                key={previewUrl}
                                                src={previewUrl}
                                                controls
                                                className="w-full h-full object-contain"
                                            />
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                            Video: {activePreview.lessonTitle || 'Lección'} - {(activePreview.content as any)?.title || 'Video'}. Listo para envío final.
                                        </div>
                                    </div>
                                );
                            } else if (activePreview && hasPreviewableAssets(activePreview.assets)) {
                                return (
                                    <div className="flex-1 flex flex-col justify-between space-y-4">
                                        <RemotionPreviewPlayer
                                            key={`${activePreview.id}-${selectedTemplateSlug ?? 'default'}`}
                                            assets={activePreview.assets}
                                            templateSlug={selectedTemplateSlug}
                                        />
                                        <div className="text-xs text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                            Previsualización en vivo del ensamblado (aún no renderizado). El video final se generará al iniciar el ensamblado con Remotion.
                                        </div>
                                    </div>
                                );
                            } else {
                                return (
                                    <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-8 text-center bg-gray-50/50 dark:bg-[#0F1419]/30">
                                        <Film className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
                                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                                            Sube assets (voz, slides, avatar o B-roll) en la Fase 6 para ver aquí la previsualización del ensamblado.
                                        </p>
                                    </div>
                                );
                            }
                        })()}
                    </div>
                </div>
            </div>
        </div>
    );
}
