
export type Esp02Route = "A_WITH_SOURCE" | "B_NO_SOURCE";

export type Esp02StepState =
  | "STEP_DRAFT"
  | "STEP_GENERATING"
  | "STEP_VALIDATING"
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
  message?: string;
  observed?: any;
}

export interface TemarioEsp02 {
  route: Esp02Route;
  source_summary?: {
    files: SourceFile[];
    notes?: string;
    utilizable?: boolean;
  };
  modules: SyllabusModule[];
  // Propiedades calculadas o agregadas
  total_estimated_hours?: number;
  
  validation: {
    automatic_pass: boolean;
    checks: ValidationCheck[];
    route_specific?: ValidationCheck[];
  };
  qa: {
    status: "PENDING" | "APPROVED" | "REJECTED";
    reviewed_by?: string;
    reviewed_at?: string;
    notes?: string;
  };
}
