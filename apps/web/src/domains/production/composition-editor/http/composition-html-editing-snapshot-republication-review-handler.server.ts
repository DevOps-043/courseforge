import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { htmlSnapshotInspectionReadRequestSchema, type HtmlSnapshotInspectionReadRequest } from "../composition-html-editing-snapshot-inspection.contract";
import { HTML_SNAPSHOT_REPUBLICATION_REVIEW_POLICY, htmlSnapshotRepublicationReviewSchema,
  matchesHtmlSnapshotRepublicationReview } from "../composition-html-editing-snapshot-republication-review.contract";

export function createHtmlSnapshotRepublicationReviewHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, request: HtmlSnapshotInspectionReadRequest, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({ ...dependencies,
    paramsSchema: z.object({ draftId: z.string().uuid(), revisionId: z.string().uuid() }).strict(),
    querySchema: z.object({ compositionId: z.string().uuid() }).strict(), resultSchema: htmlSnapshotRepublicationReviewSchema,
    policy: { maximumUrlBytes: 2048, timeoutMs: HTML_SNAPSHOT_REPUBLICATION_REVIEW_POLICY.timeoutMs, windowSeconds: 60,
      organizationRequests: 10, actorRequests: 3, maximumRateResponseBytes: 4096 },
    ratePrefix: "html-snapshot-republication-review", maximumResponseBytes: HTML_SNAPSHOT_REPUBLICATION_REVIEW_POLICY.responseBytes,
    command: (params, query, owner) => htmlSnapshotInspectionReadRequestSchema.parse({ ...params, ...query, ...owner }),
    matches: matchesHtmlSnapshotRepublicationReview,
  });
}
