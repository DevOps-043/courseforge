'use client';

import { useCallback, useState } from 'react';
import { Film, Info } from 'lucide-react';
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
import styles from '../PublicationWorkspace.module.css';

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
    <section className={styles.lessonPanel}>
      <div className={styles.lessonPanelHeader}>
        <div className={styles.panelHeading}>
          <span className={styles.panelIcon} aria-hidden="true">
            <Film size={17} />
          </span>
          <div>
            <span className={styles.eyebrow}>Contenido de la entrega</span>
            <h3>Lecciones y videos</h3>
          </div>
        </div>

        <div className={styles.selectionSummary}>
          <strong>{totalSelected}</strong>
          <span>de {totalWithVideo} incluidas</span>
        </div>
      </div>

      <div className={styles.lessonGuidance}>
        <Info size={14} />
        <span>
          Selecciona qué lecciones formarán parte de esta versión. Puedes completar
          los videos pendientes sin abandonar este panel.
        </span>
      </div>

      <div className={styles.moduleList}>
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
          <div className={styles.emptyState}>
            <Film size={20} />
            <strong>No hay lecciones disponibles</strong>
            <p>Vuelve al temario para añadir contenido al curso.</p>
          </div>
        )}
      </div>
    </section>
  );
}
