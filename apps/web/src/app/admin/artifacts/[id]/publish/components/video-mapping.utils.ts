import type {
  LessonVideoData,
  PublicationVideoLesson,
} from '@/domains/publication/types/publication.types';

export interface LessonModuleGroup {
  moduleTitle: string;
  lessons: PublicationVideoLesson[];
}

export interface ModuleCheckState {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
}

export function groupLessonsByModule(
  lessons: PublicationVideoLesson[],
): LessonModuleGroup[] {
  const groups: LessonModuleGroup[] = [];
  const seen = new Map<string, number>();

  for (const lesson of lessons) {
    const key = lesson.module_title || 'MÃ³dulo General';
    const existingIndex = seen.get(key);

    if (existingIndex !== undefined) {
      groups[existingIndex].lessons.push(lesson);
      continue;
    }

    seen.set(key, groups.length);
    groups.push({ moduleTitle: key, lessons: [lesson] });
  }

  return groups;
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function parseDuration(input: string): number {
  const clean = input.replace(/[^\d:]/g, '');
  if (clean.includes(':')) {
    const parts = clean.split(':');
    const minutes = parseInt(parts[0] || '0', 10);
    const seconds = parseInt(parts[1] || '0', 10);
    return minutes * 60 + seconds;
  }

  return parseInt(clean || '0', 10);
}

export function getModuleCheckState(
  moduleLessons: PublicationVideoLesson[],
  mappings: Record<string, LessonVideoData>,
  selectedLessons: Set<string>,
): ModuleCheckState {
  const selectableLessons = moduleLessons.filter(
    (lesson) => !!mappings[lesson.id]?.video_id,
  );

  if (selectableLessons.length === 0) {
    return { checked: false, indeterminate: false, disabled: true };
  }

  const selectedCount = selectableLessons.filter((lesson) =>
    selectedLessons.has(lesson.id),
  ).length;

  return {
    checked: selectedCount === selectableLessons.length,
    indeterminate:
      selectedCount > 0 && selectedCount < selectableLessons.length,
    disabled: false,
  };
}
