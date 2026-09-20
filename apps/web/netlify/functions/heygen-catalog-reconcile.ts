import type { Config, Handler } from "@netlify/functions";
import { HeygenRepository } from "../../src/domains/production/providers/heygen/heygen.repository";
import { signBackgroundPayload } from "../../src/lib/server/background-payload-signature";
import { createOperationalLogger, resolveCorrelationId } from "../../src/lib/server/operational-logger";
import { createServiceRoleClient, getFunctionsBaseUrl } from "./shared/bootstrap";
import { jsonResponse, methodNotAllowedResponse } from "./shared/http";

export const config: Config = { schedule: "17 */6 * * *" };

const SYNC_FRESHNESS_MS = 6 * 60 * 60 * 1000;
const MAX_SYNCS_PER_RUN = 10;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  if (event.headers["x-nf-event"] !== "schedule") {
    return jsonResponse({ error: "scheduled_invocation_required" }, 401);
  }

  const supabase = createServiceRoleClient();
  const logger = createOperationalLogger("production.heygen.catalog_reconcile", {
    correlationId: resolveCorrelationId(),
  });
  const { data: credentials, error: credentialError } = await supabase
    .from("production_provider_credentials")
    .select("organization_id")
    .eq("provider", "heygen_avatar")
    .eq("status", "ACTIVE")
    .limit(1000);
  if (credentialError) {
    logger.error("production.heygen.catalog_reconcile.credentials_failed", credentialError);
    return jsonResponse({ error: "HeyGen credential lookup failed" }, 500);
  }

  const organizationIds = [...new Set((credentials || []).map((row) => row.organization_id as string))];
  if (organizationIds.length === 0) return jsonResponse({ candidates: 0, dispatched: 0, success: true });
  const { data: workspaces, error: workspaceError } = await supabase
    .from("heygen_workspace_connections")
    .select("organization_id, last_sync_status, last_synced_at")
    .in("organization_id", organizationIds);
  if (workspaceError) {
    logger.error("production.heygen.catalog_reconcile.workspaces_failed", workspaceError);
    return jsonResponse({ error: "HeyGen workspace lookup failed" }, 500);
  }

  const workspaceByOrg = new Map((workspaces || []).map((row) => [row.organization_id as string, row]));
  const staleBefore = Date.now() - SYNC_FRESHNESS_MS;
  const candidates = organizationIds
    .filter((organizationId) => {
      const workspace = workspaceByOrg.get(organizationId);
      if (workspace?.last_sync_status === "RUNNING") return false;
      const lastSyncedAt = Date.parse(String(workspace?.last_synced_at || ""));
      return !Number.isFinite(lastSyncedAt) || lastSyncedAt < staleBefore;
    })
    .sort((left, right) => {
      const leftTime = Date.parse(String(workspaceByOrg.get(left)?.last_synced_at || "")) || 0;
      const rightTime = Date.parse(String(workspaceByOrg.get(right)?.last_synced_at || "")) || 0;
      return leftTime - rightTime;
    })
    .slice(0, MAX_SYNCS_PER_RUN);

  const repository = new HeygenRepository(supabase);
  const results = await Promise.all(candidates.map(async (organizationId) => {
    const requestId = resolveCorrelationId();
    let syncRunId: string | null = null;
    try {
      syncRunId = await repository.beginCatalogSync({ organizationId, requestId });
      const response = await fetch(
        `${getFunctionsBaseUrl()}/.netlify/functions/heygen-catalog-background`,
        {
          body: JSON.stringify(signBackgroundPayload({ organizationId, requestId, syncRunId })),
          headers: { "Content-Type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) {
      logger.error("production.heygen.catalog_reconcile.dispatch_failed", error, { organizationId, requestId });
      if (syncRunId) {
        await repository.markCatalogSyncIncomplete({
          errorMessage: error instanceof Error ? error.message : "Scheduled dispatch failed.",
          organizationId,
          status: "FAILED",
          syncRunId,
          syncedAt: new Date().toISOString(),
        }).catch((cleanupError) => logger.error("production.heygen.catalog_reconcile.cleanup_failed", cleanupError, { organizationId }));
      }
      return false;
    }
  }));

  const dispatched = results.filter(Boolean).length;
  logger.info("production.heygen.catalog_reconcile.completed", { candidates: candidates.length, dispatched });
  return jsonResponse({ candidates: candidates.length, dispatched, success: true });
};
