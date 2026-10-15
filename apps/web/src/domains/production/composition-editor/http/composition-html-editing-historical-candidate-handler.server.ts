import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "./composition-html-authenticated-read-handler.server";
import { htmlHistoricalCandidateReadRequestSchema, htmlHistoricalCandidateViewSchema, matchesHistoricalHtmlCandidate,
  type HtmlHistoricalCandidateReadRequest } from "../composition-html-editing-historical-candidate.contract";
import { HTML_HISTORICAL_PUBLICATION_HTTP_POLICY as policy } from "../composition-html-editing-historical-publication-http.contract";

export function createHtmlHistoricalCandidateHandler(dependencies: {
  enabled: () => boolean; authenticate: () => Promise<HtmlReadAuthentication>; serviceClient: () => SupabaseClient;
  read: (client: SupabaseClient, request: HtmlHistoricalCandidateReadRequest, signal: AbortSignal) => Promise<unknown>;
  logFailure?: (requestId: string) => void;
}) {
  return createHtmlAuthenticatedReadHandler({...dependencies,
    paramsSchema: z.object({draftId: z.string().uuid(), candidateId: z.string().uuid()}).strict(),
    querySchema: z.object({compositionId: z.string().uuid(), candidateSha256: z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
    resultSchema: htmlHistoricalCandidateViewSchema, policy, maximumResponseBytes: policy.maximumResponseBytes,
    ratePrefix: "html-historical-candidate",
    command: (params, query, owner) => htmlHistoricalCandidateReadRequestSchema.parse({...owner, draftId: params.draftId,
      compositionId: query.compositionId, request: {candidateId: params.candidateId, candidateSha256: query.candidateSha256}}),
    matches: matchesHistoricalHtmlCandidate,
  });
}
