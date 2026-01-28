export type CurationState =
  | 'PHASE2_DRAFT'
  | 'PHASE2_GENERATING'
  | 'PHASE2_GENERATED'
  | 'PHASE2_HITL_REVIEW'
  | 'PHASE2_READY_FOR_QA'
  | 'PHASE2_APPROVED'
  | 'PHASE2_CORRECTABLE'
  | 'PHASE2_BLOCKED'
  | 'PAUSED_REQUESTED'
  | 'PAUSED'
  | 'STOPPED_REQUESTED'
  | 'STOPPED';

export interface Curation {
  id: string;
  artifact_id: string;
  attempt_number: number;
  state: CurationState;
  qa_decision: {
    decision: 'APPROVED' | 'CORRECTABLE' | 'BLOCKED';
    notes?: string;
    reviewed_by?: string;
    reviewed_at?: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface CurationRow {
  id: string;
  curation_id: string;
  lesson_id: string;
  lesson_title: string;
  component: string;
  is_critical: boolean;
  source_ref: string;
  source_title: string | null;
  source_rationale: string | null;
  url_status: string; // 'PENDING', 'OK', 'BROKEN', etc.
  http_status_code: number | null;
  last_checked_at: string | null;
  failure_reason: string | null;
  apta: boolean | null;
  motivo_no_apta: string | null;
  cobertura_completa: boolean | null;
  notes: string | null;
  auto_evaluated: boolean | null;
  auto_reason: string | null;
  forbidden_override: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface CurationBlocker {
  id: string;
  curation_id: string;
  lesson_id: string;
  lesson_title: string;
  component: string;
  impact: string;
  owner: string;
  status: 'OPEN' | 'MITIGATING' | 'ACCEPTED';
  created_at: string;
}

// Interfaz flexible para la lectura del Plan Instruccional (LessonPlan)
export interface InstructionalLesson {
  id: string; // Ojo, a veces es lesson_id
  title: string;
  components: {
    type: string;
    is_critical?: boolean;
    // ... otros campos
  }[];
}
