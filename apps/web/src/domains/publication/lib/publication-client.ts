import { getVideoProviderAndId } from "@/lib/video-platform";
import type {
  LessonVideoData,
  PublicationCourseData,
  PublicationRequestRecord,
  PublicationVideoLesson,
} from "@/domains/publication/types/publication.types";
import { DIRECT_VIDEO_METADATA_TIMEOUT_MS } from "@/shared/constants/timing";

const DEFAULT_COURSE_DATA: PublicationCourseData = {
  category: "ia",
  level: "beginner",
  instructor_email: "",
  slug: "",
  price: 0,
  thumbnail_url: "",
};

/**
 * Generates a stable, URL-safe slug from a title.
 * Strips accents, lowercases, replaces non-alphanumeric runs with hyphens.
 * Never appends a timestamp — the result is deterministic and safe to reuse as the idempotency key on SofLIA.
 */
export function generateSlugFromTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function formatThumbnailUrl(url?: string) {
  if (!url) return "";

  const driveMatch = url.match(
    /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/,
  );

  if (driveMatch?.[1]) {
    return `https://drive.google.com/uc?export=view&id=${driveMatch[1]}`;
  }

  return url;
}

export function getInitialCourseData(
  existingRequest?: PublicationRequestRecord | null,
): PublicationCourseData {
  if (!existingRequest) {
    return DEFAULT_COURSE_DATA;
  }

  return {
    category: existingRequest.category || DEFAULT_COURSE_DATA.category,
    level: existingRequest.level || DEFAULT_COURSE_DATA.level,
    instructor_email:
      existingRequest.instructor_email || DEFAULT_COURSE_DATA.instructor_email,
    slug: existingRequest.slug || DEFAULT_COURSE_DATA.slug,
    price: existingRequest.price || DEFAULT_COURSE_DATA.price,
    thumbnail_url: formatThumbnailUrl(existingRequest.thumbnail_url) || "",
  };
}

function buildEmptyLessonMapping(
  lesson: PublicationVideoLesson,
): LessonVideoData {
  return {
    lesson_id: lesson.id,
    lesson_title: lesson.title,
    module_title: lesson.module_title,
    video_provider: "youtube",
    video_id: "",
    duration: lesson.auto_duration || 0,
  };
}

export function buildVideoMappingFromLesson(
  lesson: PublicationVideoLesson,
): LessonVideoData {
  const autoUrl = lesson.auto_video_url || "";
  const { provider, id: videoId } = getVideoProviderAndId(autoUrl);

  return {
    lesson_id: lesson.id,
    lesson_title: lesson.title,
    module_title: lesson.module_title,
    video_provider: provider,
    video_id: videoId,
    duration: lesson.auto_duration || 0,
  };
}

export function buildInitialVideoMappings(
  lessons: PublicationVideoLesson[],
  existingRequest?: PublicationRequestRecord | null,
): Record<string, LessonVideoData> {
  const draftMappings = existingRequest?.lesson_videos || {};
  const initialMappings: Record<string, LessonVideoData> = {};

  for (const lesson of lessons) {
    const draft = draftMappings[lesson.id];

    if (draft?.video_id) {
      initialMappings[lesson.id] = draft;
      continue;
    }

    if (lesson.auto_video_url) {
      initialMappings[lesson.id] = buildVideoMappingFromLesson(lesson);
      continue;
    }

    if (draft) {
      initialMappings[lesson.id] = draft;
      continue;
    }

    initialMappings[lesson.id] = buildEmptyLessonMapping(lesson);
  }

  return initialMappings;
}

export function buildInitialSelectedLessons(
  lessons: PublicationVideoLesson[],
  mappings: Record<string, LessonVideoData>,
  existingRequest?: PublicationRequestRecord | null,
) {
  if (
    existingRequest?.selected_lessons &&
    Array.isArray(existingRequest.selected_lessons)
  ) {
    return new Set(existingRequest.selected_lessons);
  }

  const autoSelected = new Set<string>();

  for (const lesson of lessons) {
    if (mappings[lesson.id]?.video_id) {
      autoSelected.add(lesson.id);
    }
  }

  return autoSelected;
}

export function buildMappingsFromProductionLessons(
  lessons: PublicationVideoLesson[],
) {
  const mappings: Record<string, LessonVideoData> = {};

  for (const lesson of lessons) {
    mappings[lesson.id] = buildVideoMappingFromLesson(lesson);
  }

  return mappings;
}

export async function getDirectVideoDuration(
  url: string,
  timeoutMs = DIRECT_VIDEO_METADATA_TIMEOUT_MS,
): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.crossOrigin = "anonymous";

    const timer = setTimeout(() => {
      video.src = "";
      resolve(0);
    }, timeoutMs);

    video.onloadedmetadata = () => {
      clearTimeout(timer);
      const duration = video.duration;
      video.src = "";
      resolve(!isNaN(duration) && duration > 0 ? Math.round(duration) : 0);
    };

    video.onerror = () => {
      clearTimeout(timer);
      resolve(0);
    };

    video.src = url;
  });
}
