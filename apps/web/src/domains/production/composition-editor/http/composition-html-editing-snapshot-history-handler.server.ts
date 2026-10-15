import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { HTML_SNAPSHOT_HISTORY_HTTP_POLICY, htmlSnapshotHistoryQuerySchema } from "../composition-html-editing-snapshot-history-http.contract";
import { HTML_SNAPSHOT_HISTORY_POLICY, htmlSnapshotHistoryRequestSchema, htmlSnapshotHistoryPageSchema,
  matchesHtmlSnapshotHistoryPage, type HtmlSnapshotHistoryRequest } from "../composition-html-editing-snapshot-history.contract";

export function createHtmlSnapshotHistoryHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, request: HtmlSnapshotHistoryRequest, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({ ...dependencies, paramsSchema: z.object({ draftId: z.string().uuid() }).strict(),
    querySchema: htmlSnapshotHistoryQuerySchema, resultSchema: htmlSnapshotHistoryPageSchema,
    policy: HTML_SNAPSHOT_HISTORY_HTTP_POLICY, ratePrefix: "html-snapshot-history", maximumResponseBytes: HTML_SNAPSHOT_HISTORY_POLICY.responseBytes,
    command: (params, query, owner) => {
      const scope = { ...owner, draftId: params.draftId, compositionId: query.compositionId };
      return htmlSnapshotHistoryRequestSchema.parse({ ...scope, cursor: query.ceilingRevision === undefined ? null
        : { ...scope, ceilingRevision: query.ceilingRevision, afterRevision: query.afterRevision } });
    }, matches: matchesHtmlSnapshotHistoryPage,
  });
}
