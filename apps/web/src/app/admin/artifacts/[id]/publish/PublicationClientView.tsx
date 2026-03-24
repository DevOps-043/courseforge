'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Send, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { CourseDataForm } from './components/CourseDataForm';
import { VideoMappingList, LessonVideoData } from './components/VideoMappingList';
import { refreshProductionVideos } from './actions';
import { ConfirmationModal } from '@/shared/components/ConfirmationModal';
import { PublishSuccessModal } from './components/PublishSuccessModal';
import { UpstreamChangeAlert } from '@/shared/components/UpstreamChangeAlert';

interface PublicationClientViewProps {
    artifactId: string;
    artifactTitle: string;
    lessons: Array<{
        id: string;
        title: string;
        module_title: string;
        auto_video_url?: string;
        auto_duration?: number;
    }>;
    existingRequest?: {
        id: string;
        category: string;
        level: string;
        instructor_email: string;
        slug: string;
        price: number;
        thumbnail_url?: string;
        lesson_videos: Record<string, LessonVideoData>; // Stored as JSONB, mapped back
        selected_lessons?: string[] | null;
        upstream_dirty?: boolean;
        upstream_dirty_source?: string;
        status: string;
    } | null;
    profile?: any;
    basePath?: string;
}

export default function PublicationClientView({
    artifactId,
    artifactTitle,
    lessons,
    existingRequest,
    profile,
    basePath = '/admin'
}: PublicationClientViewProps) {
    const router = useRouter();
    const [courseData, setCourseData] = useState(existingRequest || {
        category: 'ia',
        level: 'beginner',
        instructor_email: '',
        slug: '',
        price: 0,
        thumbnail_url: ''
    });


    const [videoMappings, setVideoMappings] = useState<Record<string, LessonVideoData>>(() => {
        // ... (existing initialization)
        const draftMappings = existingRequest?.lesson_videos || {};
        const initial: Record<string, LessonVideoData> = {};

        lessons.forEach(l => {
            const draft = draftMappings[l.id];
            const autoUrl = (l as any).auto_video_url;

            // Use draft if it has a video_id set
            if (draft && draft.video_id) {
                initial[l.id] = draft;
            }
            // Otherwise, if we have an auto-detected URL, use that
            else if (autoUrl) {
                // Auto-detect provider from URL
                let provider: 'youtube' | 'vimeo' | 'direct' = 'direct';
                let videoId = autoUrl;

                const ytMatch = autoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                const vimeoMatch = autoUrl.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)/);

                if (ytMatch) { provider = 'youtube'; videoId = ytMatch[1]; }
                else if (vimeoMatch) { provider = 'vimeo'; videoId = vimeoMatch[1]; }

                initial[l.id] = {
                    lesson_id: l.id,
                    lesson_title: l.title,
                    module_title: l.module_title,
                    video_provider: provider,
                    video_id: videoId,
                    duration: (l as any).auto_duration || 0
                };
            }
            // Fallback to empty draft if it existed
            else if (draft) {
                initial[l.id] = draft;
            }
            // Fallback for completely new items
            else {
                initial[l.id] = {
                    lesson_id: l.id,
                    lesson_title: l.title,
                    module_title: l.module_title,
                    video_provider: 'youtube', // Default
                    video_id: '',
                    duration: (l as any).auto_duration || 0
                };
            }
        });

        return initial;
    });

    // Selected lessons state — initialized from DB or computed from lessons with video
    const [selectedLessons, setSelectedLessons] = useState<Set<string>>(() => {
        if (existingRequest?.selected_lessons && Array.isArray(existingRequest.selected_lessons)) {
            return new Set(existingRequest.selected_lessons);
        }
        // Default: select all lessons that have a video
        const withVideo = new Set<string>();
        lessons.forEach(l => {
            const draft = existingRequest?.lesson_videos?.[l.id];
            if (draft?.video_id || (l as any).auto_video_url) {
                withVideo.add(l.id);
            }
        });
        return withVideo;
    });

    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);

    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [isPublishConfirmModalOpen, setIsPublishConfirmModalOpen] = useState(false);
    const [isPublishSuccessModalOpen, setIsPublishSuccessModalOpen] = useState(false);




    const handleConfirmReset = async () => {
        setIsResetting(true);
        try {
            // 1. Fetch FRESH production data from the server (not stale props)
            const result = await refreshProductionVideos(artifactId);
            if (!result.success) {
                toast.error("Error al obtener datos de producción: " + result.error);
                return;
            }

            const freshLessons = result.lessons;
            const newMappings: Record<string, LessonVideoData> = {};

            // 2. Build mappings from fresh production data (URLs + auto_duration)
            freshLessons.forEach((l: any) => {
                const autoUrl = l.auto_video_url || '';
                let provider: 'youtube' | 'vimeo' | 'direct' = 'direct';
                let videoId = autoUrl;

                if (autoUrl) {
                    const ytMatch = autoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                    const vimeoMatch = autoUrl.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)/);
                    if (ytMatch) { provider = 'youtube'; videoId = ytMatch[1]; }
                    else if (vimeoMatch) { provider = 'vimeo'; videoId = vimeoMatch[1]; }
                }

                newMappings[l.id] = {
                    lesson_id: l.id,
                    lesson_title: l.title,
                    module_title: l.module_title,
                    video_provider: provider,
                    video_id: videoId,
                    duration: l.auto_duration || 0
                };
            });

            // 3. Fetch real durations for ALL videos
            const { fetchVideoMetadata } = await import('./actions');
            let syncedCount = 0;

            // Helper: get duration for a direct/uploaded video via browser <video> element with timeout
            const getDirectVideoDuration = (url: string, timeoutMs = 15000): Promise<number> => {
                return new Promise((resolve) => {
                    const video = document.createElement('video');
                    video.preload = 'metadata';
                    video.crossOrigin = 'anonymous';
                    const timer = setTimeout(() => {
                        video.src = ''; // abort
                        resolve(0);
                    }, timeoutMs);
                    video.onloadedmetadata = () => {
                        clearTimeout(timer);
                        const d = video.duration;
                        video.src = ''; // cleanup
                        resolve(!isNaN(d) && d > 0 ? Math.round(d) : 0);
                    };
                    video.onerror = () => {
                        clearTimeout(timer);
                        resolve(0);
                    };
                    video.src = url;
                });
            };

            // Process lessons with video sequentially
            const lessonsWithVideo = freshLessons.filter((l: any) => newMappings[l.id]?.video_id);

            for (const l of lessonsWithVideo) {
                const m = newMappings[l.id];
                try {
                    if (m.video_provider === 'youtube' || m.video_provider === 'vimeo') {
                        // Server-side fetch for YT/Vimeo
                        let url = m.video_id;
                        if (m.video_provider === 'youtube' && !url.includes('http')) {
                            url = `https://www.youtube.com/watch?v=${url}`;
                        } else if (m.video_provider === 'vimeo' && !url.includes('http')) {
                            url = `https://vimeo.com/${url}`;
                        }
                        const metadata = await fetchVideoMetadata(url);
                        if (metadata.duration > 0) {
                            newMappings[l.id].duration = metadata.duration;
                            syncedCount++;
                        }
                    } else if (m.video_provider === 'direct' && m.video_id) {
                        // Client-side for direct/Supabase uploaded videos
                        // Only try if we don't already have a valid duration from production
                        if (m.duration <= 0) {
                            const duration = await getDirectVideoDuration(m.video_id);
                            if (duration > 0) {
                                newMappings[l.id].duration = duration;
                                syncedCount++;
                            }
                        } else {
                            syncedCount++; // already had duration from production
                        }
                    }
                } catch (err) {
                    console.error(`Error syncing duration for ${l.id}:`, err);
                }
            }

            // 4. Set the final state with ALL mappings updated
            setVideoMappings({ ...newMappings });

            // 5. Auto-select all lessons with video
            const withVideo = new Set<string>();
            Object.keys(newMappings).forEach(id => {
                if (newMappings[id].video_id) withVideo.add(id);
            });
            setSelectedLessons(withVideo);

            const totalWithVideo = lessonsWithVideo.length;
            toast.success(`Videos sincronizados ✓ (${totalWithVideo} videos, ${syncedCount} con duración)`);
        } catch (error) {
            console.error(error);
            toast.error("Error al restablecer mappings");
        } finally {
            setIsResetting(false);
        }
    };






    // Computed completeness status
    const missingVideos = lessons.filter(l => !videoMappings[l.id]?.video_id).length;
    const isMetadataComplete = courseData.instructor_email && courseData.slug && courseData.thumbnail_url;
    // Removed missingVideos === 0 requirement to allow partial publishing
    const isReady = isMetadataComplete;

    const handleSaveDraft = async () => {
        setIsSaving(true);
        try {
            const response = await fetch('/api/save-draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artifactId, data: { ...courseData, lesson_videos: videoMappings, selected_lessons: Array.from(selectedLessons), status: 'DRAFT' } })
            });
            const result = await response.json();

            if (result.success) {
                toast.success("Borrador guardado correctamente");
            } else {
                toast.error("Error al guardar borrador: " + result.error);
            }
        } catch (e: any) {
            toast.error("Error inesperado: " + e.message);
        } finally {
            setIsSaving(false);
            router.refresh();
        }
    };



    const handlePublish = async () => {
        setIsPublishing(true);
        setIsPublishConfirmModalOpen(false);
        try {
            // First save current state
            const saveResponse = await fetch('/api/save-draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artifactId, data: { ...courseData, lesson_videos: videoMappings, selected_lessons: Array.from(selectedLessons), status: 'READY' } })
            });
            const saveResult = await saveResponse.json();
            if (!saveResult.success) throw new Error(saveResult.error || 'Error al guardar borrador');

            // Then trigger publish via API Route instead of Server Action
            // This ensures process.env is read correctly in Netlify Edge/Node Runtime
            const response = await fetch('/api/trigger-publish', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ artifactId }),
            });

            const result = await response.json();

            if (response.ok && result.success) {
                // Instantly save, but wait for user to click "continue" on Success Modal
                setIsPublishSuccessModalOpen(true);
            } else {
                toast.error("Error al publicar en Soflia: " + (result.error || "Fallo desconocido"));
            }
        } catch (e: any) {
            toast.error("Error crítico: " + e.message);
        } finally {
            setIsPublishing(false);
        }
    };

    return (
        <div className="space-y-8">
            {/* Upstream Change Alert */}
            {existingRequest?.upstream_dirty && (
                <UpstreamChangeAlert
                    source={existingRequest?.upstream_dirty_source || 'un paso anterior'}
                    onIterate={async () => {
                        router.refresh();
                        const { dismissUpstreamDirtyAction } = await import('../../actions');
                        await dismissUpstreamDirtyAction('publication_requests', artifactId);
                    }}
                    onDismiss={async () => {
                        const { dismissUpstreamDirtyAction } = await import('../../actions');
                        await dismissUpstreamDirtyAction('publication_requests', artifactId);
                    }}
                />
            )}

            {/* Header Actions */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#151A21] p-4 rounded-xl border border-gray-200 dark:border-[#6C757D]/10">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">{artifactTitle}</h2>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${existingRequest?.status === 'SENT' ? 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' :
                            existingRequest?.status === 'APPROVED' ? 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' :
                                'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700'
                            }`}>
                            {existingRequest?.status || 'NUEVO'}
                        </span>
                        <span className="text-xs text-gray-500">
                            {lessons.length} lecciones detectadas
                        </span>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button

                        onClick={() => setIsResetModalOpen(true)}
                        disabled={isResetting || isSaving || isPublishing}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 dark:bg-[#1F2937] dark:text-gray-200 dark:border-gray-700 dark:hover:bg-[#374151] rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        title="Restablecer y Sincronizar Todo"
                    >
                        {isResetting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                    </button>



                    <button
                        onClick={handleSaveDraft}
                        disabled={isSaving || isPublishing}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 dark:bg-[#1F2937] dark:text-gray-200 dark:border-gray-700 dark:hover:bg-[#374151] rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                        {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        Guardar Borrador
                    </button>

                    {profile?.platform_role !== 'CONSTRUCTOR' && (
                        <button
                            onClick={() => setIsPublishConfirmModalOpen(true)}
                            disabled={!isReady || isSaving || isPublishing}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isReady ? 'bg-[#00D4B3] hover:bg-[#00c0a1]' : 'bg-gray-400 dark:bg-gray-600'
                                }`}
                        >
                            {isPublishing ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                            Enviar a Soflia
                        </button>
                    )}
                </div>
            </div>

            {/* Validation Error */}
            {!isReady && (
                <div className="p-4 rounded-xl flex items-start gap-3 border bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-200">
                    <AlertTriangle className="shrink-0 mt-0.5" size={18} />
                    <div>
                        <p className="font-semibold text-sm">Faltan datos requeridos para publicar:</p>
                        <ul className="list-disc list-inside text-sm mt-1 space-y-0.5 opacity-90">
                            {!isMetadataComplete && <li>Completa el email del instructor, slug y thumbnail (Requerido).</li>}
                        </ul>
                    </div>
                </div>
            )}

            {/* Partial Publication Notice */}
            {(missingVideos > 0 || (selectedLessons.size > 0 && selectedLessons.size < lessons.filter(l => !!videoMappings[l.id]?.video_id).length)) && (
                <div className="p-4 rounded-xl flex items-start gap-3 border bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-800/50 dark:text-blue-200">
                    <AlertTriangle className="shrink-0 mt-0.5" size={18} />
                    <div>
                        <p className="font-semibold text-sm">Aviso de Publicación Parcial:</p>
                        <ul className="list-disc list-inside text-sm mt-1 space-y-0.5 opacity-90">
                            {missingVideos > 0 && <li>Faltan {missingVideos} videos. Las lecciones sin video no se enviarán, pero podrás actualizarlas después.</li>}
                            {selectedLessons.size > 0 && (
                                <li>Se enviarán {selectedLessons.size} lecciones con video en este envío.</li>
                            )}
                        </ul>
                    </div>
                </div>
            )}

            {/* Forms */}
            <div className="grid gap-8">
                <CourseDataForm
                    initialData={courseData}
                    onDataChange={setCourseData}
                />

                <VideoMappingList
                    lessons={lessons}
                    mappings={videoMappings}
                    onMappingChange={setVideoMappings}
                    selectedLessons={selectedLessons}
                    onSelectionChange={setSelectedLessons}
                />
            </div>

            {/* Custom Confirmations & Alerts */}
            <ConfirmationModal
                isOpen={isPublishConfirmModalOpen}
                onClose={() => setIsPublishConfirmModalOpen(false)}
                onConfirm={async () => {
                    await handlePublish();
                }}
                title="¿Confirmas el envío a SofLIA?"
                message={
                    <div className="space-y-3">
                        <p>Esta acción creará los registros y empaquetará el curso para la plataforma de destino.</p>
                        <p className="text-sm text-gray-500">Asegúrate de haber guardado cualquier cambio en los datos antes de continuar.</p>
                    </div>
                }
                confirmText="Sí, Enviar a Soflia"
                cancelText="Cancelar"
                variant="info"
                isLoading={isPublishing}
            />

            <PublishSuccessModal
                isOpen={isPublishSuccessModalOpen}
                onClose={() => setIsPublishSuccessModalOpen(false)}
            />

            <ConfirmationModal
                isOpen={isResetModalOpen}
                onClose={() => setIsResetModalOpen(false)}
                onConfirm={async () => {
                    setIsResetModalOpen(false);
                    await handleConfirmReset();
                }}
                title="¿Sincronizar desde Producción?"
                message={
                    <div className="space-y-3">
                        <p>Esto descartará las asignaciones manuales actuales y <strong>re-cargará los videos más recientes</strong> desde el paso de producción.</p>
                        <p className="font-semibold text-yellow-500">Se sincronizarán las duraciones reales de los videos detectados (YouTube/Vimeo).</p>
                    </div>
                }
                confirmText="Sí, Sincronizar"
                cancelText="Cancelar"
                variant="warning"
                isLoading={isResetting}
            />
        </div>
    );
}
