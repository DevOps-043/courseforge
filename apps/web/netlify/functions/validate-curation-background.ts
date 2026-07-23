import { Handler } from "@netlify/functions";
import { createServiceRoleClient } from "./shared/bootstrap";
import {
  validateAndPersistCurationSource,
  type PersistedCurationSource,
} from "./shared/curation-v2/sources";
import { getErrorMessage } from "./shared/errors";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  const supabase = createServiceRoleClient();
  let artifactId: string | undefined;
  try {
    artifactId = parseJsonBody<{ artifactId?: string }>(event).artifactId;
    if (!artifactId) throw new Error("Missing artifactId");

    const { data: curation, error: curationError } = await supabase
      .from("curation")
      .select("id")
      .eq("artifact_id", artifactId)
      .maybeSingle();
    if (curationError) throw new Error(curationError.message);
    if (!curation?.id) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "No active curation found" }),
      };
    }

    await supabase
      .from("curation")
      .update({ state: "PHASE2_VALIDATING", updated_at: new Date().toISOString() })
      .eq("id", curation.id);

    const { data: rows, error: rowsError } = await supabase
      .from("curation_rows")
      .select(
        "id, source_kind, source_ref, storage_bucket, storage_path, mime_type, apta, cobertura_completa, forbidden_override",
      )
      .eq("curation_id", curation.id);
    if (rowsError) throw new Error(rowsError.message);

    let processed = 0;
    for (const row of (rows || []) as PersistedCurationSource[]) {
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

    await supabase
      .from("curation")
      .update({
        state: "PHASE2_READY_FOR_QA",
        updated_at: new Date().toISOString(),
      })
      .eq("id", curation.id);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, processed, mode: "curation-v2" }),
    };
  } catch (error) {
    console.error("[Curation V2 Validation] Error:", error);
    if (artifactId) {
      await supabase
        .from("curation")
        .update({
          state: "PHASE2_READY_FOR_QA",
          updated_at: new Date().toISOString(),
        })
        .eq("artifact_id", artifactId);
    }
    return {
      statusCode: 500,
      body: JSON.stringify({ error: getErrorMessage(error) }),
    };
  }
};

export { handler };
