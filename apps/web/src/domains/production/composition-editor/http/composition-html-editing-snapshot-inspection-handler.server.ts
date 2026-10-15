import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { HTML_SNAPSHOT_INSPECTION_POLICY, htmlSnapshotInspectionReadRequestSchema, htmlSnapshotInspectionResultSchema,
  matchesHtmlSnapshotInspection, type HtmlSnapshotInspectionReadRequest } from "../composition-html-editing-snapshot-inspection.contract";

export function createHtmlSnapshotInspectionHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, request: HtmlSnapshotInspectionReadRequest, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({ ...dependencies,
    paramsSchema: z.object({ draftId: z.string().uuid(), revisionId: z.string().uuid() }).strict(),
    querySchema: z.object({ compositionId: z.string().uuid() }).strict(), resultSchema: htmlSnapshotInspectionResultSchema,
    policy: { maximumUrlBytes: 2048, timeoutMs: HTML_SNAPSHOT_INSPECTION_POLICY.timeoutMs, windowSeconds: 60,
      organizationRequests: 10, actorRequests: 3, maximumRateResponseBytes: 4096 },
    ratePrefix: "html-snapshot-inspection", maximumResponseBytes: HTML_SNAPSHOT_INSPECTION_POLICY.responseBytes,
    command: (params, query, owner) => htmlSnapshotInspectionReadRequestSchema.parse({ ...params, ...query, ...owner }),
    matches: matchesHtmlSnapshotInspection,
  });
}
