import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBackgroundFunctionOrigin } from "../../lib/server/background-function-origin";
import { signBackgroundPayload } from "../../lib/server/background-payload-signature";
import { PIPELINE_GENERATION_LIMITS } from "../../lib/pipeline-generation-policy";
import { sourcePersistenceError } from "./course-source-error";

export function documentaryBaseScope() {
  return process.env.DOCUMENTARY_BASE_QUEUE_SCOPE?.trim() ||
    resolveBackgroundFunctionOrigin(process.env);
}

export interface DocumentaryBaseInvocation {
  artifactId: string;
  organizationId: string;
  runId: string;
}

export async function commandDocumentaryBaseInvocation(
  admin: SupabaseClient, execution: DocumentaryBaseInvocation, owner: string,
  action: "claim" | "yield" | "retry",
) {
  const { data, error } = await admin.rpc("command_documentary_base_invocation", {
    p_artifact: execution.artifactId, p_organization: execution.organizationId,
    p_run: execution.runId, p_scope: documentaryBaseScope(), p_owner: owner, p_action: action,
  });
  if (error) sourcePersistenceError(error);
  return data === true;
}

export async function dispatchDocumentaryBase(execution: DocumentaryBaseInvocation) {
  const origin = resolveBackgroundFunctionOrigin(process.env);
  const response = await fetch(`${origin}/.netlify/functions/generate-artifact-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signBackgroundPayload({ ...execution, documentary: true, continuation: true })),
    signal: AbortSignal.timeout(PIPELINE_GENERATION_LIMITS.dispatchTimeoutMs),
  });
  if (!response.ok) throw new Error(`No se pudo despachar Base (HTTP ${response.status}).`);
}
