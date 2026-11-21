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
  origin?: "automatic" | "manual";
  source_kind?: "url" | "pdf";
  storage_bucket?: string;
  storage_path?: string;
  file_name?: string;
  mime_type?: string;
  file_size_bytes?: number;
  content_sha256?: string;
  validation_report?: object;
  added_by?: string;
}
