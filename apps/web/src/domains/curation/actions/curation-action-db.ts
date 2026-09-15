import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { CURATION_STATES } from "@/lib/pipeline-constants";
import type { Curation, CurationRow } from "../types/curation.types";
import { SYSTEM_GENERATED_CURATION_ROW_FILTER } from "../lib/curation-row-rules";
import { isGenerationStale } from "@/lib/pipeline-generation-policy";

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

function isStaleGeneratingCuration(curation: Curation) {
  return (curation.state === CURATION_STATES.GENERATING || curation.state === CURATION_STATES.VALIDATING) && isGenerationStale(curation.updated_at);
}

export async function markCurationBlocked(
  admin: ServiceRoleClient,
  curationId: string,
  notes: string,
  attemptNumber?: number,
  updatedAt?: string,
) {
  const blockedDecision: NonNullable<Curation["qa_decision"]> = {
    decision: "BLOCKED",
    notes,
    reviewed_at: new Date().toISOString(),
    reviewed_by: "system",
  };

  let query = admin
    .from("curation")
    .update({
      state: CURATION_STATES.BLOCKED,
      qa_decision: blockedDecision,
      updated_at: new Date().toISOString(),
    })
    .eq("id", curationId).in("state", [CURATION_STATES.GENERATING, CURATION_STATES.VALIDATING]);
  if (attemptNumber !== undefined) query = query.eq("attempt_number", attemptNumber);
  if (updatedAt) query = query.eq("updated_at", updatedAt);
  const { error } = await query;

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

  if (isStaleGeneratingCuration(typedCuration)) {
    const notes =
      "La curaduría no registró actividad dentro del tiempo permitido. Reanuda para completar las fuentes pendientes; se conserva el progreso guardado.";
    const blockedDecision = await markCurationBlocked(
      admin,
      typedCuration.id,
      notes,
      typedCuration.attempt_number,
      typedCuration.updated_at,
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
    .select("id, state, attempt_number")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (existingCuration?.id) {
    if ([CURATION_STATES.GENERATING, CURATION_STATES.VALIDATING].includes(existingCuration.state)) {
      throw new Error("La búsqueda de fuentes ya está en curso.");
    }
    const nextAttempt = (existingCuration.attempt_number || 0) + 1;
    const { data: claimed, error: updateError } = await admin
      .from("curation")
      .update({
        state: CURATION_STATES.GENERATING,
        attempt_number: nextAttempt,
        qa_decision: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingCuration.id).eq("state", existingCuration.state)
      .eq("attempt_number", existingCuration.attempt_number).select("id").maybeSingle();

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (!claimed) throw new Error("Otra solicitud modificó la curaduría. Actualiza e inténtalo nuevamente.");
    return { id: existingCuration.id, attemptNumber: nextAttempt };
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

  return { id: newCuration.id, attemptNumber };
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
