'use client';

import {
  AlertCircle,
  ChevronDown,
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
    <div className="border border-gray-100 dark:border-[#6C757D]/10 rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 bg-gray-50/80 dark:bg-[#0F1419]/80 cursor-pointer hover:bg-gray-100/80 dark:hover:bg-[#0F1419] transition-colors select-none"
        onClick={() => onToggleCollapse(moduleTitle)}
      >
        <div
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

        <div className="flex-1 min-w-0">
          <span className="font-semibold text-sm text-gray-900 dark:text-white">
            {moduleTitle}
          </span>
          <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
            {selectedInModule}/{selectableInModule} lecciones seleccionadas
          </span>
        </div>

        <ChevronDown
          size={18}
          className={`text-gray-400 transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
        />
      </div>

      <div
        className={`transition-all duration-200 ease-in-out overflow-hidden ${isCollapsed ? 'max-h-0' : 'max-h-[5000px]'}`}
      >
        <div className="divide-y divide-gray-100 dark:divide-[#6C757D]/10">
          {lessons.map((lesson) => {
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
                className={`p-4 transition-colors ${!lessonHasVideo ? 'opacity-60 bg-gray-50/30 dark:bg-gray-900/20' : ''}`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="pt-0.5">
                    <VideoMappingCheckbox
                      checked={isSelected}
                      indeterminate={false}
                      disabled={!lessonHasVideo}
                      onChange={() => onToggleLesson(lesson.id)}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-white">
                      {lesson.title}
                    </p>
                    {lessonHasVideo ? (
                      <span
                        className={`text-xs mt-0.5 inline-block ${isSelected ? 'text-[#00D4B3]' : 'text-gray-400'}`}
                      >
                        {isSelected ? 'âœ“ Incluida en envÃ­o' : 'â€” Excluida del envÃ­o'}
                      </span>
                    ) : (
                      <span className="text-xs text-orange-500 dark:text-orange-400 mt-0.5 inline-flex items-center gap-1">
                        <AlertCircle size={11} />
                        Sin video â€” no disponible para envÃ­o
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 ml-7">
                  <div className="md:col-span-3">
                    <select
                      className="w-full bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-300"
                      value={mapping.video_provider}
                      onChange={(event) =>
                        onUpdate(lesson.id, 'video_provider', event.target.value)
                      }
                    >
                      <option value="youtube">YouTube</option>
                      <option value="vimeo">Vimeo</option>
                      <option value="direct">MP4 Directo</option>
                    </select>
                  </div>

                  <div className="md:col-span-9 relative">
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        {mapping.video_provider === 'youtube' && <Youtube size={16} />}
                        {mapping.video_provider === 'vimeo' && <Video size={16} />}
                        {mapping.video_provider === 'direct' && <LinkIcon size={16} />}
                      </div>

                      {mapping.video_provider === 'direct' &&
                      mapping.video_id.includes('supabase.co') ? (
                        <div className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg text-sm flex items-center justify-between group">
                          <div className="flex items-center gap-2 truncate text-[#00D4B3]">
                            <span className="truncate font-medium">
                              Video Interno de Plataforma
                            </span>
                            <span className="text-xs text-gray-400 truncate max-w-[150px] opacity-0 group-hover:opacity-100 transition-opacity">
                              ({mapping.video_id.split('/').pop()?.substring(0, 15)}...)
                            </span>
                          </div>
                          <button
                            onClick={() => onUpdate(lesson.id, 'video_id', '')}
                            className="text-xs text-gray-500 hover:text-red-500 transition-colors ml-2 flex-shrink-0 font-medium"
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
                          className="w-full pl-9 pr-4 py-2 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 rounded-lg text-sm focus:ring-2 focus:ring-[#00D4B3]/20 focus:border-[#00D4B3] outline-none"
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
                        <p className="text-xs text-orange-500 mt-1 flex items-center gap-1">
                          <AlertCircle size={12} /> ID de YouTube parece invÃ¡lido
                          (debe ser 11 caracteres)
                        </p>
                      )}
                  </div>

                  <div className="md:col-span-12 flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500 dark:text-gray-400">
                        DuraciÃ³n (MM:SS):
                      </label>
                      <input
                        type="text"
                        placeholder="00:00"
                        className="w-24 px-2 py-1 bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 rounded-md text-sm text-center font-mono dark:text-gray-200"
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
                    </div>
                    {mapping.video_id && (
                      <>
                        <button
                          onClick={() => onSyncDuration(lesson.id)}
                          disabled={syncingId === lesson.id}
                          className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1 disabled:opacity-50"
                          title="Sincronizar duraciÃ³n exacta desde YouTube/Vimeo"
                        >
                          {syncingId === lesson.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <RefreshCw size={12} />
                          )}
                          Sinc.
                        </button>
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
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                          ProbÃ¡r enlace â†—
                        </a>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
