import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getOrganizationHyperframesApiKey } from "../_shared/credentials.ts";
import { getHyperframesRender, HeygenHttpError } from "../_shared/heygen.ts";
import { isPermanentProviderFailure } from "../_shared/hyperframes-retry-policy.ts";
import { authorizeWorker, jsonResponse, logEvent, methodNotAllowed } from "../_shared/http.ts";
import { rpc } from "../_shared/supabase.ts";

interface ReconciliationClaim {
  lease_token: string;
  organization_id: string;
  production_job_id: string;
  provider_render_id: string;
  request_id: string;
  retry_count: number;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return methodNotAllowed();
  const unauthorized = authorizeWorker(request);
  if (unauthorized) return unauthorized;

  try {
    const claims = await rpc<ReconciliationClaim[]>("claim_hyperframes_reconciliations", {
      p_lease_seconds: 120,
      p_limit: 8,
    });
    const credentialCache = new Map<string, Promise<string>>();
    const results = await Promise.allSettled(
      claims.map((claim) => processClaim(claim, credentialCache)),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    logEvent(failed ? "warn" : "info", "hyperframes_reconciliation_batch", {
      claimed: claims.length,
      failed,
      succeeded: claims.length - failed,
    });
    return jsonResponse({ claimed: claims.length, failed });
  } catch (error) {
    logEvent("error", "hyperframes_reconciliation_batch_failed", { message: safeMessage(error) });
    return jsonResponse({ error: "reconciliation_failed" }, 500);
  }
});

async function processClaim(
  claim: ReconciliationClaim,
  credentialCache: Map<string, Promise<string>>,
): Promise<void> {
  try {
    let credential = credentialCache.get(claim.organization_id);
    if (!credential) {
      credential = getOrganizationHyperframesApiKey(claim.organization_id);
      credentialCache.set(claim.organization_id, credential);
    }
    const detail = await getHyperframesRender(await credential, claim.provider_render_id);
    const action = await rpc<string>("apply_hyperframes_reconciliation", {
      p_failure_message: detail.failure_message || null,
      p_lease_token: claim.lease_token,
      p_provider_render_id: detail.render_id,
      p_provider_status: detail.status,
      p_request_id: claim.request_id,
    });
    logEvent("info", "hyperframes_render_reconciled", {
      action,
      providerStatus: detail.status,
      requestId: claim.request_id,
    });
  } catch (error) {
    if (error instanceof HeygenHttpError && isPermanentProviderFailure(error.status)) {
      await rpc<string>("apply_hyperframes_reconciliation", {
        p_failure_message: safeMessage(error), p_lease_token: claim.lease_token,
        p_provider_render_id: claim.provider_render_id, p_provider_status: "failed", p_request_id: claim.request_id,
      });
      return;
    }
    const retryAfter = error instanceof HeygenHttpError && error.status === 429
      ? 120
      : Math.min(30 * 2 ** Math.min(claim.retry_count, 5), 900);
    try {
      await rpc<void>("reschedule_hyperframes_reconciliation", {
        p_error_message: safeMessage(error),
        p_lease_token: claim.lease_token,
        p_request_id: claim.request_id,
        p_retry_after_seconds: retryAfter,
      });
    } catch (rescheduleError) {
      logEvent("error", "hyperframes_reconciliation_reschedule_failed", {
        message: safeMessage(rescheduleError),
        requestId: claim.request_id,
      });
    }
    throw error;
  }
}

function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "Unknown reconciliation error").slice(0, 500);
}
