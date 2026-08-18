import type {
  LessonVideoData,
  PublicationVideoLesson,
} from "../types/publication.types";

/** Internal direct URLs are mirrors of Production, not independent draft data. */
export function shouldRestoreDraftVideoMapping(mapping?: LessonVideoData) {
  return Boolean(mapping && mapping.video_provider !== "direct");
}

/** Removes deleted lessons and lessons whose current mapping no longer has video. */
export function reconcileSelectedLessonIds(params: {
  lessons: PublicationVideoLesson[];
  mappings: Record<string, LessonVideoData>;
  selectedLessonIds: string[];
}) {
  const currentLessonIds = new Set(params.lessons.map((lesson) => lesson.id));
  return params.selectedLessonIds.filter(
    (lessonId) => currentLessonIds.has(lessonId) && Boolean(params.mappings[lessonId]?.video_id),
  );
}
