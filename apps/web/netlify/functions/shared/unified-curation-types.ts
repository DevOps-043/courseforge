export interface LessonToProcess {
  lesson_id: string;
  lesson_title: string;
  lesson_objective: string;
  module_title: string;
  component_count: number;
}

export interface LessonSource {
  url: string;
  title: string;
  rationale: string;
  key_topics_covered: string[];
  estimated_quality: number;
}

export interface LessonResult {
  lesson_id: string;
  lesson_title: string;
  sources: LessonSource[];
}

export interface GroundingSource {
  uri: string;
  title: string;
}

export interface CourseModuleLike {
  title?: string | null;
  name?: string | null;
}

export interface ArtifactContextLike {
  title?: string | null;
  description?: string | null;
  main_topic?: string | null;
  audience?: string | null;
  objectives?: string[] | null;
}

export interface SyllabusContextLike {
  modules?: CourseModuleLike[] | null;
  keywords?: string[] | null;
  learning_objectives?: string[] | null;
}

export interface LessonPlanLike {
  lesson_id?: string | null;
  id?: string | null;
  lesson_title?: string | null;
  title?: string | null;
  objective?: string | null;
  summary?: string | null;
  description?: string | null;
  module_title?: string | null;
  components?: unknown[] | null;
}

export interface CourseContextSummary {
  courseTitle: string;
  courseDescription: string;
  courseAudience: string;
  learningObjectives: string[];
  moduleNames: string[];
  keywords: string[];
  fullCourseContext: string;
}
