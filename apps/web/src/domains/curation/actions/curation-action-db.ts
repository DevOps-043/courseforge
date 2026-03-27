import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { CURATION_STATES } from "@/lib/pipeline-constants";
import type { Curation, CurationRow } from "../types/curation.types";

type ServiceRoleClient = ReturnType<typeof getServiceRoleClient>;

interface ArtifactCurationSummary {
  idea_central: string | null;
  course_id: string | null;
}

interface InstructionalPlanSummary {
  lesson_plans: unknown;
}

export async function fetchCurationSnapshot(
  admin: ServiceRoleClient,
  artifactId: string,
) {
  const { data: curation, error: curationError } = await admin
    .from("curation")
    .select("*")
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
    .select("*")
    .eq("curation_id", curation.id)
    .order("lesson_title", { ascending: true });

  if (rowsError) {
    throw new Error(rowsError.message);
  }

  return {
    curation: curation as Curation,
    rows: (rows as CurationRow[] | null) || [],
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

export async function ensureImportReadyCurationRecord(
  admin: ServiceRoleClient,
  artifactId: string,
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
    return existingCuration.id;
  }

  const { data: newCuration, error: createError } = await admin
    .from("curation")
    .insert({
      artifact_id: artifactId,
      state: CURATION_STATES.READY_FOR_QA,
      attempt_number: 1,
    })
    .select("id")
    .single();

  if (createError || !newCuration?.id) {
    throw new Error("Error creando registro de curaduria.");
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
    .eq("source_rationale", "GPT_GENERATED");

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
