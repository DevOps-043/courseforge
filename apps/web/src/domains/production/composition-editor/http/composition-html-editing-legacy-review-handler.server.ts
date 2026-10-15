import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HTML_LEGACY_ADOPTION_HTTP_POLICY as policy } from "../composition-html-editing-legacy-adoption-http-policy";
import { HTML_LEGACY_REVIEW_POLICY, htmlLegacyReviewCommandSchema, htmlLegacyReviewQuerySchema,
  htmlLegacyReviewViewSchema, type HtmlLegacyReviewCommand } from "../composition-html-editing-legacy-review.contract";
import { HtmlLegacyAdoptionPersistenceError } from "../composition-html-editing-legacy-adoption-repository.server";
import { HtmlEditingLegacyAdoptionError } from "../composition-html-editing-legacy-adoption.server";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";

const paramsSchema = z.object({ draftId: z.string().uuid(), clipId: htmlLegacyReviewCommandSchema.shape.clipId,
  candidateId: z.string().uuid() }).strict();
/** Read-only candidate lookup, not approval registration or catalogue discovery. */
export function createHtmlLegacyReviewHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, command: HtmlLegacyReviewCommand, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({ ...dependencies, paramsSchema, querySchema: htmlLegacyReviewQuerySchema,
    resultSchema: htmlLegacyReviewViewSchema, policy, ratePrefix: "html-legacy-review", maximumResponseBytes: HTML_LEGACY_REVIEW_POLICY.responseBytes,
    command: (params, query, owner) => htmlLegacyReviewCommandSchema.parse({ ...owner, documentId: params.draftId,
      clipId: params.clipId, candidateId: params.candidateId, ...query }),
    matches: (data, command) => data.actorId === command.actorId && data.organizationId === command.organizationId
      && data.documentId === command.documentId && data.clipId === command.clipId
      && data.request.candidateId === command.candidateId && data.request.expectedDocumentHash === command.expectedDocumentHash,
    isConflict: error => error instanceof HtmlLegacyAdoptionPersistenceError && error.code === "CONFLICT"
      || error instanceof HtmlEditingLegacyAdoptionError && error.code === "BASE_CONFLICT",
  });
}
