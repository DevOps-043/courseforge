
export type Esp02Route = "A_WITH_SOURCE" | "B_NO_SOURCE";

export type SyllabusInputMode = "GENERATE" | "IMPORT";

export type Esp02StepState =
  | "STEP_DRAFT"
  | "STEP_GENERATING"
  | "STEP_VALIDATING"
  | "STEP_REVIEW"
  | "STEP_READY_FOR_QA"
  | "STEP_APPROVED"
  | "STEP_REJECTED"
  | "STEP_ESCALATED";

export interface SyllabusLesson {
  id?: string; // Opcional al generar, obligatorio al guardar
  title: string;
  objective_specific: string;
  estimated_minutes?: number;
}

export interface SyllabusModule {
  id?: string; // Opcional al generar
  objective_general_ref: string;
  title: string;
  lessons: SyllabusLesson[];
}

export interface SourceFile {
  file_id: string;
  filename: string;
  mime: string;
}

export interface ValidationCheck {
  code: string;
  pass: boolean;
  message: string;
  observed?: unknown;
}

export interface SyllabusValidationReport {
  automatic_pass: boolean;
  checks: ValidationCheck[];
  route_specific?: ValidationCheck[];
}

export interface SyllabusGenerationMetadata {
  files?: SourceFile[];
  notes?: string;
  utilizable?: boolean;
  search_queries?: string[];
  research_summary?: string;
  search_sources?: unknown;
  models_used?: {
    search?: string;
    architect?: string;
  };
  models?: {
    search?: string;
    architect?: string;
  };
  generated_at?: string;
  validation_attempts?: number;
  final_validation_errors?: string[];
  error?: string;
}

export interface SyllabusQaState {
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewed_by?: string;
  reviewed_at?: string;
  notes?: string;
}

export interface TemarioEsp02 {
  route: Esp02Route;
  state?: Esp02StepState;
  generation_metadata?: SyllabusGenerationMetadata;
  source_summary?: SyllabusGenerationMetadata;
  modules: SyllabusModule[];
  // Propiedades calculadas o agregadas
  total_estimated_hours?: number;
  
  validation: SyllabusValidationReport;
  qa: SyllabusQaState;
  // Propiedades de seguimiento de iteración
  upstream_dirty?: boolean;
  upstream_dirty_source?: string;
}

export interface SyllabusRow extends TemarioEsp02 {
  id?: string;
  artifact_id: string;
  state: Esp02StepState;
  iteration_count?: number;
  created_at?: string;
  updated_at?: string;
}
