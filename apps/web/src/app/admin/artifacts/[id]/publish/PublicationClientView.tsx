'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Send, AlertTriangle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { CourseDataForm } from './components/CourseDataForm';
import { VideoMappingList, LessonVideoData } from './components/VideoMappingList';
import { savePublicationDraft, fetchVideoMetadata } from './actions';
import { ConfirmationModal } from '@/shared/components/ConfirmationModal';

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
        status: string;
    } | null;
}

export default function PublicationClientView({
    artifactId,
    artifactTitle,
    lessons,
    existingRequest
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

    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);

    const [isResetModalOpen, setIsResetModalOpen] = useState(false);




    const handleConfirmReset = async () => {
        setIsResetting(true);
        try {
            const newMappings: Record<string, LessonVideoData> = {};
            const promises: Promise<void>[] = [];

            // 1. Build initial mappings from auto-detect
            lessons.forEach(l => {
                const autoUrl = (l as any).auto_video_url;
                let provider: 'youtube' | 'vimeo' | 'direct' = 'direct';
                let videoId = autoUrl || '';

                if (autoUrl) {
                    const ytMatch = autoUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
                    const vimeoMatch = autoUrl.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/(?:[^\/]*)\/videos\/|album\/(?:\d+)\/video\/|video\/|)(\d+)/);
                    if (ytMatch) { provider = 'youtube'; videoId = ytMatch[1]; }
                    else if (vimeoMatch) { provider = 'vimeo'; videoId = vimeoMatch[1]; }
                }

                // Create mapping object
                const mapping = {
                    lesson_id: l.id,
                    lesson_title: l.title,
                    module_title: l.module_title,
                    video_provider: provider,
                    video_id: videoId,
                    duration: (l as any).auto_duration || 0
                };
                newMappings[l.id] = mapping;

                // 2. Queue synchronization if we have a valid ID
                if (videoId && (provider === 'youtube' || provider === 'vimeo')) {
                    const fullUrl = provider === 'youtube'
                        ? `https://www.youtube.com/watch?v=${videoId}`
                        : `https://vimeo.com/${videoId}`;

                    // We run this async without blocking the main loop immediately
                    // But we wait for all of them before setting state
                    const p = fetchVideoMetadata(fullUrl).then(meta => {
                        if (meta.duration > 0) {
                            newMappings[l.id].duration = meta.duration;
                        }
                    }).catch(console.error);
                    promises.push(p);
                }
            });

            // Wait for all syncs to finish
            await Promise.all(promises);

            setVideoMappings(newMappings);
            toast.success("Mapeo restablecido y duraciones sincronizadas");
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
    const isReady = isMetadataComplete && missingVideos === 0;

    const handleSaveDraft = async () => {
        setIsSaving(true);
        try {
            const result = await savePublicationDraft(artifactId, {
                ...courseData,
                lesson_videos: videoMappings,
                status: 'DRAFT'
            });

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
        if (!confirm("¿Estás seguro de enviar este curso a Soflia? Esta acción creará los registros en la plataforma de destino.")) return;

        setIsPublishing(true);
        try {
            // First save current state
            await savePublicationDraft(artifactId, {
                ...courseData,
                lesson_videos: videoMappings,
                status: 'READY'
            });

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
                toast.success("¡Curso enviado exitosamente a Soflia!");
                router.push(`/admin/artifacts/${artifactId}`);
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

                    <button
                        onClick={handlePublish}
                        disabled={!isReady || isSaving || isPublishing}
                        className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isReady ? 'bg-[#00D4B3] hover:bg-[#00c0a1]' : 'bg-gray-400 dark:bg-gray-600'
                            }`}
                    >
                        {isPublishing ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                        Enviar a Soflia
                    </button>
                </div>
            </div>

            {/* Validation Warning */}
            {!isReady && (
                <div className="bg-orange-50 border border-orange-200 text-orange-800 dark:bg-orange-900/20 dark:border-orange-800/50 dark:text-orange-200 px-4 py-3 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="shrink-0 mt-0.5" size={18} />
                    <div>
                        <p className="font-semibold text-sm">Faltan datos para publicar:</p>
                        <ul className="list-disc list-inside text-sm mt-1 space-y-0.5 opacity-90">
                            {!isMetadataComplete && <li>Completa el email del instructor, slug y thumbnail.</li>}
                            {missingVideos > 0 && <li>Asigna videos a {missingVideos} lecciones faltantes.</li>}
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
                />
            </div>

            <ConfirmationModal
                isOpen={isResetModalOpen}
                onClose={() => setIsResetModalOpen(false)}
                onConfirm={async () => {
                    setIsResetModalOpen(false);
                    await handleConfirmReset();
                }}
                title="¿Restablecer y Sincronizar?"
                message={
                    <div className="space-y-3">
                        <p>Esto borrará todas tus asignaciones manuales actuales y volverá a detectar los videos desde el contenido original.</p>
                        <p className="font-semibold text-yellow-500">Además, se sincronizarán las duraciones reales de todos los videos detectados.</p>
                    </div>
                }
                confirmText="Sí, Restablecer"
                cancelText="Cancelar"
                variant="warning"
                isLoading={isResetting}
            />
        </div>
    );
}
