'use client';

import { useCallback, useState } from 'react';
import { Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  buildVideoUrl,
  detectVideoProvider,
  fetchVideoMetadataClient,
} from '@/lib/video-platform';
import type {
  LessonVideoData,
  PublicationVideoLesson,
} from '@/domains/publication/types/publication.types';
import {
  getModuleCheckState,
  groupLessonsByModule,
} from './video-mapping.utils';
import { VideoMappingModuleSection } from './VideoMappingModuleSection';
import { VIDEO_DURATION_AUTOSYNC_DELAY_MS } from '@/shared/constants/timing';

export async function syncVideoDuration(
  provider: 'youtube' | 'vimeo' | 'direct',
  videoId: string,
): Promise<number> {
  if (!videoId) return 0;

  if (provider === 'direct') {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.crossOrigin = 'anonymous';

      video.onloadedmetadata = () => {
        const durationRaw = video.duration;
        if (!isNaN(durationRaw) && durationRaw > 0) {
          resolve(Math.round(durationRaw));
        } else {
          reject(new Error('No se pudo leer la duración del archivo.'));
        }
      };

      video.onerror = () => {
        reject(
          new Error(
            'No se pudo obtener la duración del MP4. Verifica el enlace y bloqueadores (CORS).',
          ),
        );
      };

      video.src = videoId;
    });
  }

  const metadata = await fetchVideoMetadataClient(buildVideoUrl(provider, videoId));
  return metadata.duration || 0;
}

interface VideoMappingListProps {
  lessons: PublicationVideoLesson[];
  mappings: Record<string, LessonVideoData>;
  onMappingChange: (mappings: Record<string, LessonVideoData>) => void;
  selectedLessons: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
}

export function VideoMappingList({
  lessons,
  mappings,
  onMappingChange,
  selectedLessons,
  onSelectionChange,
}: VideoMappingListProps) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [collapsedModules, setCollapsedModules] = useState<Set<string>>(new Set());

  const hasVideo = useCallback(
    (lessonId: string) => !!mappings[lessonId]?.video_id,
    [mappings],
  );

  const toggleCollapse = (moduleTitle: string) => {
    setCollapsedModules((previous) => {
      const next = new Set(previous);
      if (next.has(moduleTitle)) {
        next.delete(moduleTitle);
      } else {
        next.add(moduleTitle);
      }
      return next;
    });
  };

  const toggleLesson = (lessonId: string) => {
    if (!hasVideo(lessonId)) return;
    const next = new Set(selectedLessons);
    if (next.has(lessonId)) {
      next.delete(lessonId);
    } else {
      next.add(lessonId);
    }
    onSelectionChange(next);
  };

  const toggleModule = (moduleLessons: PublicationVideoLesson[]) => {
    const selectableLessons = moduleLessons.filter((lesson) => hasVideo(lesson.id));
    if (selectableLessons.length === 0) return;

    const allSelected = selectableLessons.every((lesson) =>
      selectedLessons.has(lesson.id),
    );
    const next = new Set(selectedLessons);

    if (allSelected) {
      selectableLessons.forEach((lesson) => next.delete(lesson.id));
    } else {
      selectableLessons.forEach((lesson) => next.add(lesson.id));
    }

    onSelectionChange(next);
  };

  const handleUpdate = (
    lessonId: string,
    field: keyof LessonVideoData,
    value: string | number | LessonVideoData['video_provider'],
  ) => {
    const lesson = lessons.find((entry) => entry.id === lessonId);
    if (!lesson) return;

    const currentMapping: LessonVideoData = mappings[lessonId] || {
      lesson_id: lessonId,
      lesson_title: lesson.title,
      module_title: lesson.module_title,
      video_provider: 'youtube',
      video_id: '',
      duration: 0,
    };

    let nextMapping = currentMapping;
    let shouldAutoSync = false;

    if (field === 'video_id' && typeof value === 'string') {
      const { provider, id } = detectVideoProvider(value);
      if (provider) {
        nextMapping = {
          ...currentMapping,
          video_provider: provider,
          video_id: id,
        };
        shouldAutoSync = true;
      } else {
        nextMapping = {
          ...currentMapping,
          video_id: value,
        };
      }
    } else if (field === 'video_provider' && typeof value === 'string') {
      nextMapping = {
        ...currentMapping,
        video_provider: value as LessonVideoData['video_provider'],
      };
    } else if (field === 'duration' && typeof value === 'number') {
      nextMapping = {
        ...currentMapping,
        duration: value,
      };
    }

    const newMappings = { ...mappings, [lessonId]: nextMapping };
    onMappingChange(newMappings);

    if (field === 'video_id' && typeof value === 'string' && value && !selectedLessons.has(lessonId)) {
      const next = new Set(selectedLessons);
      next.add(lessonId);
      onSelectionChange(next);
    }

    if (field === 'video_id' && typeof value === 'string' && !value && selectedLessons.has(lessonId)) {
      const next = new Set(selectedLessons);
      next.delete(lessonId);
      onSelectionChange(next);
    }

    if (shouldAutoSync && nextMapping.video_id) {
      setTimeout(() => {
        void handleSyncDuration(lessonId, nextMapping);
      }, VIDEO_DURATION_AUTOSYNC_DELAY_MS);
    }
  };

  const handleSyncDuration = async (
    lessonId: string,
    mappingOverride?: LessonVideoData,
  ) => {
    const mapping = mappingOverride || mappings[lessonId];
    if (!mapping || !mapping.video_id) return;

    setSyncingId(lessonId);

    try {
      const durationSec = await syncVideoDuration(
        mapping.video_provider,
        mapping.video_id,
      );
      if (durationSec > 0) {
        handleUpdate(lessonId, 'duration', durationSec);
        toast.success(`Duración actualizada: ${Math.floor(durationSec / 60).toString().padStart(2, '0')}:${(durationSec % 60).toString().padStart(2, '0')}`);
      } else {
        toast.error(
          'No se pudo obtener la duración. Verifica que el video sea válido y público.',
        );
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Error al sincronizar duración.';
      console.error(error);
      toast.error(message);
    } finally {
      setSyncingId(null);
    }
  };

  const moduleGroups = groupLessonsByModule(lessons);
  const totalSelected = lessons.filter((lesson) => selectedLessons.has(lesson.id)).length;
  const totalWithVideo = lessons.filter((lesson) => hasVideo(lesson.id)).length;

  return (
    <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">
          2. Asignación de Videos y Selección para Envío
        </h3>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
          {totalSelected}/{totalWithVideo} seleccionadas para envío
        </span>
      </div>

      <div className="flex items-center gap-2 mb-5 text-xs text-gray-500 dark:text-gray-400">
        <Info size={14} className="shrink-0" />
        <span>
          Marca las lecciones que deseas incluir en el envío a SofLIA. Solo las
          lecciones con video asignado pueden seleccionarse.
        </span>
      </div>

      <div className="space-y-4">
        {moduleGroups.map(({ moduleTitle, lessons: moduleLessons }) => (
          <VideoMappingModuleSection
            key={moduleTitle}
            moduleTitle={moduleTitle}
            lessons={moduleLessons}
            mappings={mappings}
            selectedLessons={selectedLessons}
            syncingId={syncingId}
            isCollapsed={collapsedModules.has(moduleTitle)}
            checkState={getModuleCheckState(
              moduleLessons,
              mappings,
              selectedLessons,
            )}
            onToggleCollapse={toggleCollapse}
            onToggleModule={toggleModule}
            onToggleLesson={toggleLesson}
            onUpdate={handleUpdate}
            onSyncDuration={(lessonId) => handleSyncDuration(lessonId)}
          />
        ))}

        {lessons.length === 0 && (
          <p className="text-center text-gray-500 py-4">
            No se encontraron lecciones en este curso.
          </p>
        )}
      </div>
    </div>
  );
}
