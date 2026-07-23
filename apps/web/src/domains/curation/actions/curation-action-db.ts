import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { CURATION_STATES } from "@/lib/pipeline-constants";
import type { Curation, CurationRow } from "../types/curation.types";
import { SYSTEM_GENERATED_CURATION_ROW_FILTER } from "../lib/curation-row-rules";

type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

interface ArtifactCurationSummary {
  idea_central: string | null;
  course_id: string | null;
}

interface InstructionalPlanSummary {
  lesson_plans: unknown;
}

const CURATION_SNAPSHOT_SELECT = `
  id,
  artifact_id,
  attempt_number,
  state,
  qa_decision,
  created_at,
  updated_at,
  upstream_dirty,
  upstream_dirty_source
`;

const CURATION_ROWS_SNAPSHOT_SELECT = `
  id,
  curation_id,
  lesson_id,
  lesson_title,
  component,
  is_critical,
  source_ref,
  source_title,
  source_rationale,
  url_status,
  http_status_code,
  last_checked_at,
  failure_reason,
  apta,
  motivo_no_apta,
  cobertura_completa,
  notes,
  auto_evaluated,
  auto_reason,
  forbidden_override,
  origin,
  source_kind,
  storage_bucket,
  storage_path,
  file_name,
  mime_type,
  file_size_bytes,
  content_sha256,
  validation_report,
  added_by,
  created_at,
  updated_at
`;

const STALE_GENERATING_CURATION_MS = 15 * 60 * 1000;

function isStaleGeneratingCuration(curation: Curation, rowsCount: number) {
  if (curation.state !== CURATION_STATES.GENERATING || rowsCount > 0) {
    return false;
  }

  const updatedAt = Date.parse(curation.updated_at);
  return Number.isFinite(updatedAt)
    ? Date.now() - updatedAt > STALE_GENERATING_CURATION_MS
    : false;
}

export async function markCurationBlocked(
  admin: ServiceRoleClient,
  curationId: string,
  notes: string,
) {
  const blockedDecision: NonNullable<Curation["qa_decision"]> = {
    decision: "BLOCKED",
    notes,
    reviewed_at: new Date().toISOString(),
    reviewed_by: "system",
  };

  const { error } = await admin
    .from("curation")
    .update({
      state: CURATION_STATES.BLOCKED,
      qa_decision: blockedDecision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", curationId);

  if (error) {
    throw new Error(error.message);
  }

  return blockedDecision;
}

export async function fetchCurationSnapshot(
  admin: ServiceRoleClient,
  artifactId: string,
) {
  const { data: curation, error: curationError } = await admin
    .from("curation")
    .select(CURATION_SNAPSHOT_SELECT)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (curationError) {
    throw new Error(curationError.message);
  }

  if (!curation?.id) {
    return {
      curation: (curation as Curation | null) || null,
      rows: [] as CurationRow[],
    };
  }

  const { data: rows, error: rowsError } = await admin
    .from("curation_rows")
    .select(CURATION_ROWS_SNAPSHOT_SELECT)
    .eq("curation_id", curation.id)
    .order("lesson_title", { ascending: true });

  if (rowsError) {
    throw new Error(rowsError.message);
  }

  const typedRows = (rows as CurationRow[] | null) || [];
  let typedCuration = curation as Curation;

  if (isStaleGeneratingCuration(typedCuration, typedRows.length)) {
    const notes =
      "La curaduria quedo en ejecucion sin fuentes generadas ni actividad reciente. El disparo del background pudo fallar o quedar bloqueado antes de iniciar la busqueda.";
    const blockedDecision = await markCurationBlocked(
      admin,
      typedCuration.id,
      notes,
    );
    typedCuration = {
      ...typedCuration,
      qa_decision: blockedDecision,
      state: CURATION_STATES.BLOCKED,
      updated_at: new Date().toISOString(),
    };
  }

  return {
    curation: typedCuration,
    rows: typedRows,
  };
}

export async function fetchArtifactAndPlanForCuration(
  admin: ServiceRoleClient,
  artifactId: string,
) {
  const { data: artifact, error: artifactError } = await admin
    .from("artifacts")
    .select("idea_central, course_id")
    .eq("id", artifactId)
    .single();

  if (artifactError || !artifact) {
    throw new Error("Artifact not found");
  }

  const { data: plan, error: planError } = await admin
    .from("instructional_plans")
    .select("lesson_plans")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (planError) {
    throw new Error(`Database error fetching plan: ${planError.message}`);
  }

  if (!plan) {
    throw new Error(
      "No Instructional Plan found. Please go back to Step 3 and generate/approve the plan first.",
    );
  }

  return {
    artifact: artifact as ArtifactCurationSummary,
    plan: plan as InstructionalPlanSummary,
  };
}

export async function ensureGeneratingCurationRecord(
  admin: ServiceRoleClient,
  artifactId: string,
  attemptNumber: number,
) {
  const { data: existingCuration, error: existingError } = await admin
    .from("curation")
    .select("id")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingCuration?.id) {
    const { error: updateError } = await admin
      .from("curation")
      .update({
        state: CURATION_STATES.GENERATING,
        attempt_number: attemptNumber,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingCuration.id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return existingCuration.id;
  }

  const { data: newCuration, error: createError } = await admin
    .from("curation")
    .insert({
      artifact_id: artifactId,
      state: CURATION_STATES.GENERATING,
      attempt_number: attemptNumber,
    })
    .select("id")
    .single();

  if (createError || !newCuration?.id) {
    throw new Error(
      `Failed to create curation record: ${createError?.message || "Unknown error"}`,
    );
  }

  return newCuration.id;
}

export async function clearGeneratedCurationRows(
  admin: ServiceRoleClient,
  curationId: string,
) {
  const { error } = await admin
    .from("curation_rows")
    .delete()
    .eq("curation_id", curationId)
    .or(SYSTEM_GENERATED_CURATION_ROW_FILTER);

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteCurationByArtifactId(
  admin: ServiceRoleClient,
  artifactId: string,
) {
  const { error } = await admin
    .from("curation")
    .delete()
    .eq("artifact_id", artifactId);

  if (error) {
    throw new Error(error.message);
  }
}
