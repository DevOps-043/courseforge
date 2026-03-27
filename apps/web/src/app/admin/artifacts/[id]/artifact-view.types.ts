import type { SyllabusModule } from "@/domains/syllabus/types/syllabus.types";

export type ArtifactEditingSection =
  | "nombres"
  | "objetivos"
  | "descripcion"
  | null;

export interface ArtifactDescription {
  beneficios?: string;
  publico_objetivo?: string;
  resumen?: string;
  texto?: string;
}

export interface ArtifactGenerationMetadata {
  search_queries?: string[];
  [key: string]: unknown;
}

export interface ArtifactValidationResultItem {
  message: string;
  passed: boolean;
}

export interface ArtifactValidationReport {
  all_passed?: boolean;
  results: ArtifactValidationResultItem[];
}

export interface ArtifactDisplayProfile {
  email?: string | null;
  first_name?: string | null;
  platform_role?: string | null;
}

export interface ArtifactQaStatus {
  status?: string | null;
}

export interface ArtifactQaDecision {
  decision?: string | null;
}

export interface ArtifactApprovals {
  architect_status?: string | null;
}

export interface ArtifactStageRelation {
  approvals?: ArtifactApprovals | null;
  final_status?: string | null;
  id?: string | null;
  qa?: ArtifactQaStatus | null;
  qa_decision?: ArtifactQaDecision | null;
  state?: string | null;
}

export interface ArtifactTemarioRelation extends ArtifactStageRelation {
  modules?: SyllabusModule[] | null;
}

export interface ArtifactMaterialsRelation extends ArtifactStageRelation {
  id: string;
}

export interface ArtifactViewRecord {
  courseId?: string | null;
  course_id?: string | null;
  created_at: string;
  curation?: ArtifactStageRelation | null;
  descripcion?: ArtifactDescription | null;
  generation_metadata?: ArtifactGenerationMetadata | null;
  id: string;
  idea_central?: string | null;
  instructional_plan?: ArtifactStageRelation | null;
  materials?: ArtifactMaterialsRelation | null;
  nombres?: string[] | null;
  objetivos?: string[] | null;
  production_complete?: boolean | null;
  qa_status?: string | null;
  state: string;
  temario?: ArtifactTemarioRelation | null;
  validation_report?: ArtifactValidationReport | null;
  [key: string]: unknown;
}

export interface ArtifactEditedContent {
  descripcion: {
    beneficios: string;
    publico_objetivo: string;
    texto: string;
  };
  nombres: string[];
  objetivos: string[];
}

export interface ArtifactContentUpdates {
  descripcion?: ArtifactDescription;
  nombres?: string[];
  objetivos?: string[];
}
