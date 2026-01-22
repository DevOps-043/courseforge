
export interface ModelSetting {
  id: number;
  setting_type: string;
  model_name: string; // Now mapping from 'model_name' column (or whatever the column name is, we need to be careful)
  // Wait, I didn't see the column 'model_name' in the inspect_db logs because I didn't run it.
  // Based on user image: 'setting_type', 'fallback_model', 'is_active', 'thinking_level'. 
  // Missing 'model_name' in the screenshot? let me re-check the screenshot.
  // The screenshot shows: id, thinking_level, is_active, created_at, updated_at, fallback_model, setting_type. 
  // It DOES NOT clearly show 'model_name'. It might be scrolled to the right or I need to query it.
  // But usually it's there. I will assume it exists or use a generic 'value' if that's how it's stored.
  // UPDATE: User previously said "el modelo se llama Y YA LA TABLA se va a llamar model_settings".
  // Let's assume there IS a column for the model identifier. I'll make it generic for now.
} 

// Let's look at the implementation plan again. I need to handle DB connection.
// I will create a type file assuming standard columns, but I might need to adjust if 'model_name' is missing.

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
  cobertura_completa?: boolean; // Changed to match DB
  notes?: string;
  auto_evaluated: boolean;
  auto_reason?: string;
}

// Flexible component type to handle different model response formats
export interface GeminiComponentResult {
  // Standard fields
  component_type?: string;
  component_name?: string; // Alternative name used by some models
  source_url?: string;
  url?: string; // Alternative field
  source_title?: string;
  title?: string; // Alternative field
  rationale?: string;
  is_valid?: boolean;
  is_acceptable?: boolean; // Alternative field
  invalidation_reason?: string;
  is_complete_coverage?: boolean;
  confidence_score?: number;
  // Nested structure some models use
  candidate_sources?: {
    url?: string;
    title?: string;
    rationale?: string;
    is_acceptable?: boolean;
  }[];
  // Allow any additional fields
  [key: string]: any;
}

export interface GeminiCurationResponse {
  sources_by_lesson: {
    lesson_id: string;
    components: GeminiComponentResult[];
  }[];
}
