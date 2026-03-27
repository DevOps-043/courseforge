import type {
  ComponentType,
  DemoGuideContent,
  DialogueContent,
  ExerciseContent,
  MaterialAssets,
  MaterialsPackage,
  QuizContent,
  ReadingContent,
  VideoContent,
} from "@/domains/materials/types/materials.types";

export type PublicationVideoProvider = "youtube" | "vimeo" | "direct";

export type PublicationRequestStatus =
  | "DRAFT"
  | "READY"
  | "SENT"
  | "APPROVED"
  | "REJECTED";

export interface LessonVideoData {
  lesson_id: string;
  lesson_title: string;
  module_title: string;
  video_provider: PublicationVideoProvider;
  video_id: string;
  duration: number;
}

export interface PublicationCourseData {
  category: string;
  level: string;
  instructor_email: string;
  slug: string;
  price: number;
  thumbnail_url?: string;
}

export interface PublicationProfile {
  platform_role?: string | null;
}

export type PublicationComponentContent =
  | DialogueContent
  | ReadingContent
  | QuizContent
  | DemoGuideContent
  | ExerciseContent
  | VideoContent
  | Record<string, unknown>;

export interface PublicationComponent {
  type: ComponentType;
  assets?: MaterialAssets | null;
  content?: PublicationComponentContent | null;
}

export interface PublicationVideoLesson {
  id: string;
  title: string;
  module_title: string;
  auto_video_url?: string;
  auto_duration?: number;
}

export interface PublicationLesson extends PublicationVideoLesson {
  summary?: string;
  components: PublicationComponent[];
}

export interface PublicationRequestRecord extends PublicationCourseData {
  id: string;
  lesson_videos: Record<string, LessonVideoData>;
  selected_lessons?: string[] | null;
  upstream_dirty?: boolean;
  upstream_dirty_source?: string;
  status: PublicationRequestStatus | string;
}

export interface PublicationArtifactRecord {
  id: string;
  title: string;
  description: unknown;
}

export interface PublicationDraftData extends PublicationCourseData {
  lesson_videos: Record<string, LessonVideoData>;
  selected_lessons?: string[] | null;
  status: "DRAFT" | "READY";
}

export interface PublicationDataResult {
  artifact: PublicationArtifactRecord;
  lessons: PublicationLesson[];
  request: PublicationRequestRecord | null;
  materialsPackage: MaterialsPackage | null;
}

export interface PublicationPayloadActivity {
  title: string;
  type: string;
  data: Record<string, unknown>;
}

export interface PublicationPayloadMaterial {
  title: string;
  type: string;
  description?: string;
  url?: string;
  data?: Record<string, unknown>;
}

export interface PublicationPayloadLesson {
  title: string;
  order_index: number;
  duration_seconds: number;
  duration: number;
  summary: string;
  description: string;
  transcription: string;
  video_url: string;
  video_provider: string;
  video_provider_id: string;
  is_free: boolean;
  content_blocks: Record<string, never>[];
  activities: PublicationPayloadActivity[];
  materials: PublicationPayloadMaterial[];
}

export interface PublicationPayloadModule {
  title: string;
  order_index: number;
  lessons: PublicationPayloadLesson[];
}

export interface PublicationPayload {
  source: {
    platform: "courseengine";
    version: "1.0";
    artifact_id: string;
  };
  course: {
    title: string;
    description: string;
    slug: string;
    category: string;
    level: string;
    instructor_email: string;
    price: number;
    thumbnail_url?: string;
    is_published: false;
  };
  modules: PublicationPayloadModule[];
}

export interface PublicationPreviewLesson {
  title: string;
  order_index: number;
  video_provider: string;
  video_provider_id: string;
  has_transcription: boolean;
}

export interface PublicationPreviewModule {
  title: string;
  order_index: number;
  lessons: PublicationPreviewLesson[];
}

export interface PublicationPreviewPayload {
  course: {
    title: string;
    slug: string;
  };
  modules: PublicationPreviewModule[];
}
