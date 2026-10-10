import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { htmlHistoricalCandidateReadRequestSchema, htmlHistoricalCandidateViewSchema, matchesHistoricalHtmlCandidate,
  type HtmlHistoricalCandidateReadRequest } from "./composition-html-editing-historical-candidate.contract";
import { HTML_HISTORICAL_PUBLICATION_HTTP_POLICY as policy } from "./composition-html-editing-historical-publication-http.contract";

const envelope = z.object({success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlHistoricalCandidateViewSchema}).strict();
/** Explicit GET only. No local persistence, approval, upload or registration. */
export async function consultHistoricalHtmlCandidate(input: {request: HtmlHistoricalCandidateReadRequest; signal: AbortSignal; fetcher?: typeof fetch}) {
  try {
    const request = htmlHistoricalCandidateReadRequestSchema.parse(input.request);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
    const query = new URLSearchParams({compositionId: request.compositionId, candidateSha256: request.request.candidateSha256});
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.draftId}/html-historical-candidates/${request.request.candidateId}?${query}`,
      {method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal});
    if (response.status !== 200) throw new Error();
    const result = envelope.parse(await readBoundedCompositionJson(response, policy.maximumResponseBytes + 1024, signal));
    if (result.requestId !== result.correlationId || !matchesHistoricalHtmlCandidate(result.data, request)) throw new Error();
    signal.throwIfAborted(); return result.data;
  } catch {throw new Error("HTML_HISTORICAL_CANDIDATE_UNAVAILABLE");}
}
