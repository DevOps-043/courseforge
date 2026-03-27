export interface ModelSetting {
  id: number;
  setting_type: string;
  model_name: string;
  fallback_model?: string | null;
  thinking_level?: string | null;
  is_active?: boolean;
}

export interface CurationRowInsert {
  curation_id: string;
  lesson_id: string;
  lesson_title: string;
  component: string;
  is_critical: boolean;
  source_ref: string;
  source_title?: string;
  source_rationale?: string;
  url_status: string;
  apta: boolean;
  motivo_no_apta?: string;
  cobertura_completa?: boolean;
  notes?: string;
  auto_evaluated: boolean;
  auto_reason?: string;
}

export interface GeminiCandidateSource {
  url?: string;
  title?: string;
  rationale?: string;
  is_acceptable?: boolean;
}

export interface GeminiComponentResult {
  component_type?: string;
  component_name?: string;
  source_url?: string;
  url?: string;
  source_title?: string;
  title?: string;
  rationale?: string;
  is_valid?: boolean;
  is_acceptable?: boolean;
  invalidation_reason?: string;
  is_complete_coverage?: boolean;
  confidence_score?: number;
  candidate_sources?: GeminiCandidateSource[];
  [key: string]: unknown;
}

export interface GeminiCurationLesson {
  lesson_id: string;
  components: GeminiComponentResult[];
}

export interface GeminiCurationResponse {
  sources_by_lesson: GeminiCurationLesson[];
}
