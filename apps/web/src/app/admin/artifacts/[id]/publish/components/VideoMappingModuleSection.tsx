'use client';

import {
  AlertCircle,
  ChevronDown,
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Video,
  Youtube,
} from 'lucide-react';
import type {
  LessonVideoData,
  PublicationVideoLesson,
} from '@/domains/publication/types/publication.types';
import {
  formatDuration,
  parseDuration,
  type ModuleCheckState,
} from './video-mapping.utils';
import { VideoMappingCheckbox } from './VideoMappingCheckbox';
import { EngineSelect } from '@/components/ui/EngineSelect';
import styles from '../PublicationWorkspace.module.css';

interface VideoMappingModuleSectionProps {
  moduleTitle: string;
  lessons: PublicationVideoLesson[];
  mappings: Record<string, LessonVideoData>;
  selectedLessons: Set<string>;
  syncingId: string | null;
  isCollapsed: boolean;
  checkState: ModuleCheckState;
  onToggleCollapse: (moduleTitle: string) => void;
  onToggleModule: (lessons: PublicationVideoLesson[]) => void;
  onToggleLesson: (lessonId: string) => void;
  onUpdate: (
    lessonId: string,
    field: keyof LessonVideoData,
    value: string | number | LessonVideoData['video_provider'],
  ) => void;
  onSyncDuration: (lessonId: string) => Promise<void>;
}

export function VideoMappingModuleSection({
  moduleTitle,
  lessons,
  mappings,
  selectedLessons,
  syncingId,
  isCollapsed,
  checkState,
  onToggleCollapse,
  onToggleModule,
  onToggleLesson,
  onUpdate,
  onSyncDuration,
}: VideoMappingModuleSectionProps) {
  const selectedInModule = lessons.filter((lesson) =>
    selectedLessons.has(lesson.id),
  ).length;
  const selectableInModule = lessons.filter(
    (lesson) => !!mappings[lesson.id]?.video_id,
  ).length;

  return (
    <section className={styles.moduleCard}>
      <div className={styles.moduleHeader}>
        <div
          className={styles.moduleCheckbox}
          onClick={(event) => {
            event.stopPropagation();
            onToggleModule(lessons);
          }}
        >
          <VideoMappingCheckbox
            checked={checkState.checked}
            indeterminate={checkState.indeterminate}
            disabled={checkState.disabled}
            onChange={() => onToggleModule(lessons)}
          />
        </div>

        <button
          type="button"
          className={styles.moduleTitleButton}
          onClick={() => onToggleCollapse(moduleTitle)}
          aria-expanded={!isCollapsed}
        >
          <span>{moduleTitle}</span>
          <small>{lessons.length} lecciones</small>
        </button>

        <span className={styles.moduleCount}>
          {selectedInModule}/{selectableInModule}
          <small>incluidas</small>
        </span>

        <button
          type="button"
          className={styles.moduleToggle}
          onClick={() => onToggleCollapse(moduleTitle)}
          aria-label={isCollapsed ? `Abrir ${moduleTitle}` : `Cerrar ${moduleTitle}`}
        >
          <ChevronDown
            size={18}
            className={isCollapsed ? styles.chevronCollapsed : ''}
          />
        </button>
      </div>

      <div
        className={`${styles.moduleBody} ${isCollapsed ? styles.moduleBodyCollapsed : ''}`}
      >
        <div className={styles.lessonList}>
          {lessons.map((lesson, lessonIndex) => {
            const mapping = mappings[lesson.id] || {
              lesson_id: lesson.id,
              lesson_title: lesson.title,
              module_title: lesson.module_title,
              video_provider: 'youtube' as const,
              video_id: '',
              duration: 0,
            };
            const lessonHasVideo = !!mapping.video_id;
            const isSelected = selectedLessons.has(lesson.id);

            return (
              <div
                key={lesson.id}
                className={styles.lessonRow}
                data-has-video={lessonHasVideo}
                data-selected={isSelected}
              >
                <div className={styles.lessonHeading}>
                  <div className={styles.lessonCheckbox}>
                    <VideoMappingCheckbox
                      checked={isSelected}
                      indeterminate={false}
                      disabled={!lessonHasVideo}
                      onChange={() => onToggleLesson(lesson.id)}
                    />
                  </div>
                  <span className={styles.lessonNumber}>{lessonIndex + 1}</span>
                  <div className={styles.lessonTitleBlock}>
                    <p>
                      {lesson.title}
                    </p>
                    {lessonHasVideo ? (
                      <span className={styles.lessonState} data-state={isSelected ? 'included' : 'excluded'}>
                        {isSelected ? 'Incluida en el envío' : 'No incluida'}
                      </span>
                    ) : (
                      <span className={styles.lessonWarning}>
                        <AlertCircle size={11} />
                        Falta asignar un video
                      </span>
                    )}
                  </div>
                </div>

                <div className={styles.mappingEditor}>
                  <div className={styles.mappingField}>
                    <label>Fuente</label>
                    <EngineSelect
                      value={mapping.video_provider}
                      onValueChange={(value) => onUpdate(lesson.id, 'video_provider', value)}
                      options={[
                        { value: 'youtube', label: 'YouTube' },
                        { value: 'vimeo', label: 'Vimeo' },
                        { value: 'direct', label: 'MP4 directo' },
                      ]}
                    />
                  </div>

                  <div className={`${styles.mappingField} ${styles.videoField}`}>
                    <label>Enlace o identificador</label>
                    <div className={styles.videoInputWrap}>
                      <div className={styles.videoInputIcon}>
                        {mapping.video_provider === 'youtube' && <Youtube size={16} />}
                        {mapping.video_provider === 'vimeo' && <Video size={16} />}
                        {mapping.video_provider === 'direct' && <LinkIcon size={16} />}
                      </div>

                      {mapping.video_provider === 'direct' &&
                      mapping.video_id.includes('supabase.co') ? (
                        <div className={styles.internalVideo}>
                          <div>
                            <span>
                              Video Interno de Plataforma
                            </span>
                            <small>
                              ({mapping.video_id.split('/').pop()?.substring(0, 15)}...)
                            </small>
                          </div>
                          <button
                            type="button"
                            onClick={() => onUpdate(lesson.id, 'video_id', '')}
                            className={styles.removeVideoButton}
                            title="Eliminar este enlace"
                          >
                            Eliminar
                          </button>
                        </div>
                      ) : (
                        <input
                          type="text"
                          placeholder={
                            mapping.video_provider === 'youtube'
                              ? 'Pegar URL de YouTube o ID...'
                              : mapping.video_provider === 'vimeo'
                                ? 'Pegar URL de Vimeo o ID...'
                                : 'URL del archivo de video (.mp4)...'
                          }
                          className={styles.videoInput}
                          value={mapping.video_id}
                          onChange={(event) =>
                            onUpdate(lesson.id, 'video_id', event.target.value)
                          }
                        />
                      )}
                    </div>
                    {mapping.video_id &&
                      mapping.video_provider === 'youtube' &&
                      mapping.video_id.length !== 11 && (
                        <p className={styles.inputWarning}>
                          <AlertCircle size={12} /> ID de YouTube parece inválido
                          (debe ser 11 caracteres)
                        </p>
                      )}
                  </div>

                  <div className={`${styles.mappingField} ${styles.durationField}`}>
                    <label>Duración</label>
                    <div className={styles.durationControl}>
                      <input
                        type="text"
                        placeholder="00:00"
                        className={styles.durationInput}
                        value={formatDuration(mapping.duration)}
                        onChange={(event) =>
                          onUpdate(
                            lesson.id,
                            'duration',
                            parseDuration(event.target.value),
                          )
                        }
                        onBlur={(event) =>
                          onUpdate(
                            lesson.id,
                            'duration',
                            parseDuration(event.target.value),
                          )
                        }
                      />
                      {mapping.video_id && (
                        <button
                          type="button"
                          onClick={() => void onSyncDuration(lesson.id)}
                          disabled={syncingId === lesson.id}
                          className={styles.syncButton}
                          title="Sincronizar duración exacta desde YouTube/Vimeo"
                          aria-label="Sincronizar duración"
                        >
                          {syncingId === lesson.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RefreshCw size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {mapping.video_id && (
                    <div className={styles.mappingActions}>
                        <a
                          href={
                            mapping.video_provider === 'youtube'
                              ? `https://www.youtube.com/watch?v=${mapping.video_id}`
                              : mapping.video_provider === 'vimeo'
                                ? `https://vimeo.com/${mapping.video_id}`
                                : mapping.video_id
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.linkButton}
                        >
                          <ExternalLink size={12} />
                          Abrir video
                        </a>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
