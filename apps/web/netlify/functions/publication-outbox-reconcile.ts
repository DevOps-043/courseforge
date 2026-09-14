import type { Config, Handler } from "@netlify/functions";
import { isRecoverablePublicationOutbox } from "../../src/domains/publication/publication-outbox";
import { signBackgroundPayload } from "../../src/lib/server/background-payload-signature";
import { createOperationalLogger, resolveCorrelationId } from "../../src/lib/server/operational-logger";
import { createServiceRoleClient, getFunctionsBaseUrl } from "./shared/bootstrap";
import { jsonResponse, methodNotAllowedResponse } from "./shared/http";

export const config: Config = { schedule: "*/5 * * * *" };

interface RecoverablePublicationRow {
  correlation_id: string | null;
  id: string;
  publish_lease_expires_at: string | null;
  publish_step: string | null;
  updated_at: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  if (event.headers["x-nf-event"] !== "schedule") {
    return jsonResponse({ error: "scheduled_invocation_required" }, 401);
  }

  const supabase = createServiceRoleClient();
  const logger = createOperationalLogger("publication.reconcile", {
    correlationId: resolveCorrelationId(),
  });
  const { data, error } = await supabase
    .from("publication_requests")
    .select("id, correlation_id, publish_step, publish_lease_expires_at, updated_at")
    .eq("status", "READY")
    .in("publish_step", ["QUEUED", "RUNNING"])
    .order("updated_at", { ascending: true })
    .limit(10);
  if (error) {
    logger.error("publication.reconcile.lookup_failed", error);
    return jsonResponse({ error: "Publication reconciliation lookup failed" }, 500);
  }

  const recoverable = ((data || []) as RecoverablePublicationRow[]).filter((row) =>
    isRecoverablePublicationOutbox(
      row.publish_step,
      row.publish_lease_expires_at,
      row.updated_at,
    ),
  );
  const results = await Promise.all(recoverable.map(async (row) => {
    try {
      const response = await fetch(
        `${getFunctionsBaseUrl()}/.netlify/functions/publication-outbox-background`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(signBackgroundPayload({
            correlationId: resolveCorrelationId(row.correlation_id),
            requestId: row.id,
          })),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (dispatchError) {
      logger.error("publication.reconcile.dispatch_failed", dispatchError, {
        correlationId: resolveCorrelationId(row.correlation_id),
        requestId: row.id,
      });
      return false;
    }
  }));
  const dispatched = results.filter(Boolean).length;
  logger.info("publication.reconcile.completed", { candidates: recoverable.length, dispatched });

  return jsonResponse({ candidates: recoverable.length, dispatched, success: true });
};
