import { Handler } from "@netlify/functions";
import {
  createServiceRoleClient,
  getOptionalOpenAiApiKey,
  getSupabaseServiceKey,
  getSupabaseUrl,
} from "./shared/bootstrap";
import { processUnifiedCuration } from "./unified-curation-logic";
import {
  validateAndPersistCurationSource,
  type PersistedCurationSource,
} from "./shared/curation-v2/sources";
import { getErrorMessage } from "./shared/errors";
import {
  methodNotAllowedResponse,
  parseVerifiedBackgroundBody,
  unauthorizedBackgroundResponse,
} from "./shared/http";

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  let artifactId: string | undefined;
  try {
    artifactId = (
      await parseVerifiedBackgroundBody<{ artifactId?: string }>(event)
    ).artifactId;
  } catch {
    return unauthorizedBackgroundResponse();
  }
  if (!artifactId) {
    return { statusCode: 400, body: "Missing artifactId" };
  }

  const supabase = createServiceRoleClient();
  let attemptNumber: number | undefined;
  try {
    const { data: curation, error: curationError } = await supabase
      .from("curation")
      .select("id, state, attempt_number")
      .eq("artifact_id", artifactId)
      .maybeSingle();
    if (curationError) throw new Error(curationError.message);
    if (!curation?.id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "No active curation found" }),
      };
    }

    if (["PHASE2_GENERATING", "PHASE2_VALIDATING"].includes(curation.state)) {
      return { statusCode: 409, body: JSON.stringify({ error: "La curaduría ya está en ejecución." }) };
    }
    attemptNumber = (curation.attempt_number || 0) + 1;
    const { data: claimed, error: claimError } = await supabase
      .from("curation")
      .update({
        state: "PHASE2_VALIDATING",
        attempt_number: attemptNumber,
        updated_at: new Date().toISOString(),
      })
      .eq("id", curation.id).eq("state", curation.state).eq("attempt_number", curation.attempt_number)
      .select("id").maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) return { statusCode: 409, body: "Curation changed" };

    const { data: rows, error: rowsError } = await supabase
      .from("curation_rows")
      .select(
        "id, source_kind, source_ref, storage_bucket, storage_path, mime_type, apta, cobertura_completa, forbidden_override",
      )
      .eq("curation_id", curation.id);
    if (rowsError) throw new Error(rowsError.message);

    let processed = 0;
    for (const row of (rows || []) as PersistedCurationSource[]) {
      const { data: active, error: heartbeatError } = await supabase.from("curation")
        .update({ updated_at: new Date().toISOString() }).eq("id", curation.id)
        .eq("attempt_number", attemptNumber).eq("state", "PHASE2_VALIDATING").select("id").maybeSingle();
      if (heartbeatError) throw heartbeatError;
      if (!active) return { statusCode: 200, body: JSON.stringify({ superseded: true }) };
      try {
        await validateAndPersistCurationSource(supabase, row);
      } catch (error) {
        const reason = getErrorMessage(error);
        await supabase
          .from("curation_rows")
          .update({
            url_status: "REVIEW_REQUIRED",
            validation_report: {
              status: "review_required",
              checked_at: new Date().toISOString(),
              reason,
              checks: {},
            },
            failure_reason: reason,
            auto_evaluated: true,
            auto_reason: reason,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
      }
      processed += 1;
    }

    const openAiApiKey = getOptionalOpenAiApiKey();
    if (!openAiApiKey) {
      throw new Error("OPENAI_API_KEY is required for autonomous curation.");
    }
    const { data: active, error: transitionError } = await supabase.from("curation")
      .update({ state: "PHASE2_GENERATING", updated_at: new Date().toISOString() }).eq("id", curation.id)
      .eq("attempt_number", attemptNumber).eq("state", "PHASE2_VALIDATING").select("id").maybeSingle();
    if (transitionError) throw transitionError;
    if (!active) return { statusCode: 200, body: JSON.stringify({ superseded: true }) };
    const inserted = await processUnifiedCuration({
      artifactId,
      curationId: curation.id,
      openAiApiKey,
      resume: true,
      attemptNumber: attemptNumber!,
      supabaseUrl: getSupabaseUrl(),
      supabaseKey: getSupabaseServiceKey(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        processed,
        inserted,
        mode: "autonomous-curation-v2",
      }),
    };
  } catch (error) {
    console.error("[Curation V2 Validation] Error:", error);
    if (artifactId) {
      await supabase
        .from("curation")
        .update({
          state: "PHASE2_BLOCKED",
          qa_decision: {
            decision: "BLOCKED",
            notes: `La validacion y reposicion automatica fallo: ${getErrorMessage(error)}`,
            reviewed_by: "gpt:auto",
            reviewed_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        })
        .eq("artifact_id", artifactId).eq("attempt_number", attemptNumber ?? -1)
        .in("state", ["PHASE2_GENERATING", "PHASE2_VALIDATING"]);
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: getErrorMessage(error) }),
    };
  }
};

export { handler };
