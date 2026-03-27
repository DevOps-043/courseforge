'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { getErrorMessage } from '@/lib/errors';
import {
    buildInitialSelectedLessons,
    buildInitialVideoMappings,
    buildMappingsFromProductionLessons,
    getDirectVideoDuration,
    getInitialCourseData,
} from '@/domains/publication/lib/publication-client';
import type {
    LessonVideoData,
    PublicationCourseData,
    PublicationProfile,
    PublicationRequestRecord,
    PublicationVideoLesson,
} from '@/domains/publication/types/publication.types';
import { dismissUpstreamDirtyAction } from '@/lib/server/pipeline-dirty-actions';
import { buildVideoUrl, fetchVideoMetadata } from '@/lib/video-platform';
import { ConfirmationModal } from '@/shared/components/ConfirmationModal';
import { UpstreamChangeAlert } from '@/shared/components/UpstreamChangeAlert';
import { refreshProductionVideos } from './actions';
import { CourseDataForm } from './components/CourseDataForm';
import { PublicationAlerts } from './components/PublicationAlerts';
import { PublicationHeader } from './components/PublicationHeader';
import { PublishSuccessModal } from './components/PublishSuccessModal';
import { VideoMappingList } from './components/VideoMappingList';

interface PublicationClientViewProps {
    artifactId: string;
    artifactTitle: string;
    lessons: PublicationVideoLesson[];
    existingRequest?: PublicationRequestRecord | null;
    profile?: PublicationProfile;
    basePath?: string;
}

async function savePublicationDraftRequest(
    artifactId: string,
    data: PublicationCourseData,
    lessonVideos: Record<string, LessonVideoData>,
    selectedLessons: Set<string>,
    status: 'DRAFT' | 'READY',
) {
    const response = await fetch('/api/save-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            artifactId,
            data: {
                ...data,
                lesson_videos: lessonVideos,
                selected_lessons: Array.from(selectedLessons),
                status,
            },
        }),
    });

    const result = (await response.json()) as { success?: boolean; error?: string };
    if (!result.success) {
        throw new Error(result.error || 'Error al guardar borrador');
    }

    return result;
}

export default function PublicationClientView({
    artifactId,
    artifactTitle,
    lessons,
    existingRequest,
    profile,
    basePath: _basePath = '/admin',
}: PublicationClientViewProps) {
    const router = useRouter();
    const initialMappings = buildInitialVideoMappings(lessons, existingRequest);
    const [courseData, setCourseData] = useState<PublicationCourseData>(() =>
        getInitialCourseData(existingRequest),
    );
    const [videoMappings, setVideoMappings] = useState<Record<string, LessonVideoData>>(
        initialMappings,
    );
    const [selectedLessons, setSelectedLessons] = useState<Set<string>>(() =>
        buildInitialSelectedLessons(lessons, initialMappings, existingRequest),
    );
    const [isSaving, setIsSaving] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [isPublishConfirmModalOpen, setIsPublishConfirmModalOpen] =
        useState(false);
    const [isPublishSuccessModalOpen, setIsPublishSuccessModalOpen] =
        useState(false);

    const missingVideos = lessons.filter(
        (lesson) => !videoMappings[lesson.id]?.video_id,
    ).length;
    const selectableLessonsCount = lessons.filter(
        (lesson) => !!videoMappings[lesson.id]?.video_id,
    ).length;
    const isMetadataComplete = Boolean(
        courseData.instructor_email &&
            courseData.slug &&
            courseData.thumbnail_url,
    );
    const isReady = isMetadataComplete;

    const handleConfirmReset = async () => {
        setIsResetting(true);

        try {
            const result = await refreshProductionVideos(artifactId);
            if (!result.success) {
                toast.error(
                    `Error al obtener datos de produccion: ${result.error}`,
                );
                return;
            }

            const newMappings = buildMappingsFromProductionLessons(result.lessons);
            const lessonsWithVideo = result.lessons.filter(
                (lesson) => !!newMappings[lesson.id]?.video_id,
            );
            let syncedCount = 0;

            for (const lesson of lessonsWithVideo) {
                const mapping = newMappings[lesson.id];
                if (!mapping) {
                    continue;
                }

                try {
                    if (
                        mapping.video_provider === 'youtube' ||
                        mapping.video_provider === 'vimeo'
                    ) {
                        const metadata = await fetchVideoMetadata(
                            buildVideoUrl(
                                mapping.video_provider,
                                mapping.video_id,
                            ),
                        );

                        if (metadata.duration > 0) {
                            newMappings[lesson.id].duration = metadata.duration;
                            syncedCount += 1;
                        }
                        continue;
                    }

                    if (
                        mapping.video_provider === 'direct' &&
                        mapping.video_id &&
                        mapping.duration <= 0
                    ) {
                        const duration = await getDirectVideoDuration(
                            mapping.video_id,
                        );
                        if (duration > 0) {
                            newMappings[lesson.id].duration = duration;
                            syncedCount += 1;
                        }
                        continue;
                    }

                    if (mapping.duration > 0) {
                        syncedCount += 1;
                    }
                } catch (error) {
                    console.error(
                        `Error syncing duration for ${lesson.id}:`,
                        error,
                    );
                }
            }

            setVideoMappings({ ...newMappings });
            setSelectedLessons(
                new Set(
                    Object.keys(newMappings).filter(
                        (lessonId) => !!newMappings[lessonId]?.video_id,
                    ),
                ),
            );

            toast.success(
                `Videos sincronizados (${lessonsWithVideo.length} videos, ${syncedCount} con duracion)`,
            );
        } catch (error) {
            console.error(error);
            toast.error('Error al restablecer mappings');
        } finally {
            setIsResetting(false);
        }
    };

    const handleSaveDraft = async () => {
        setIsSaving(true);

        try {
            await savePublicationDraftRequest(
                artifactId,
                courseData,
                videoMappings,
                selectedLessons,
                'DRAFT',
            );
            toast.success('Borrador guardado correctamente');
        } catch (error: unknown) {
            toast.error(
                `Error inesperado: ${getErrorMessage(error, 'Error desconocido')}`,
            );
        } finally {
            setIsSaving(false);
            router.refresh();
        }
    };

    const handlePublish = async () => {
        setIsPublishing(true);
        setIsPublishConfirmModalOpen(false);

        try {
            await savePublicationDraftRequest(
                artifactId,
                courseData,
                videoMappings,
                selectedLessons,
                'READY',
            );

            const response = await fetch('/api/trigger-publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ artifactId }),
            });
            const result = (await response.json()) as {
                success?: boolean;
                error?: string;
            };

            if (response.ok && result.success) {
                setIsPublishSuccessModalOpen(true);
            } else {
                toast.error(
                    `Error al publicar en Soflia: ${result.error || 'Fallo desconocido'}`,
                );
            }
        } catch (error: unknown) {
            toast.error(
                `Error critico: ${getErrorMessage(error, 'Error desconocido')}`,
            );
        } finally {
            setIsPublishing(false);
        }
    };

    return (
        <div className="space-y-8">
            {existingRequest?.upstream_dirty && (
                <UpstreamChangeAlert
                    source={
                        existingRequest.upstream_dirty_source ||
                        'un paso anterior'
                    }
                    onIterate={async () => {
                        router.refresh();
                        await dismissUpstreamDirtyAction(
                            'publication_requests',
                            artifactId,
                        );
                    }}
                    onDismiss={async () => {
                        await dismissUpstreamDirtyAction(
                            'publication_requests',
                            artifactId,
                        );
                        router.refresh();
                    }}
                />
            )}

            <PublicationHeader
                artifactTitle={artifactTitle}
                lessonsCount={lessons.length}
                status={existingRequest?.status}
                profile={profile}
                isReady={isReady}
                isSaving={isSaving}
                isPublishing={isPublishing}
                isResetting={isResetting}
                onReset={() => setIsResetModalOpen(true)}
                onSaveDraft={() => {
                    void handleSaveDraft();
                }}
                onPublish={() => setIsPublishConfirmModalOpen(true)}
            />

            <PublicationAlerts
                isMetadataComplete={isMetadataComplete}
                missingVideos={missingVideos}
                selectedLessonsCount={selectedLessons.size}
                selectableLessonsCount={selectableLessonsCount}
            />

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

            <ConfirmationModal
                isOpen={isPublishConfirmModalOpen}
                onClose={() => setIsPublishConfirmModalOpen(false)}
                onConfirm={async () => {
                    await handlePublish();
                }}
                title="Confirmas el envio a Soflia?"
                message={
                    <div className="space-y-3">
                        <p>
                            Esta accion creara los registros y empaquetara el
                            curso para la plataforma de destino.
                        </p>
                        <p className="text-sm text-gray-500">
                            Asegurate de haber guardado cualquier cambio antes
                            de continuar.
                        </p>
                    </div>
                }
                confirmText="Si, Enviar a Soflia"
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
                title="Sincronizar desde Produccion?"
                message={
                    <div className="space-y-3">
                        <p>
                            Esto descartara las asignaciones manuales actuales
                            y recargara los videos mas recientes desde el paso
                            de produccion.
                        </p>
                        <p className="font-semibold text-yellow-500">
                            Se sincronizaran las duraciones reales de los videos
                            detectados.
                        </p>
                    </div>
                }
                confirmText="Si, Sincronizar"
                cancelText="Cancelar"
                variant="warning"
                isLoading={isResetting}
            />
        </div>
    );
}
