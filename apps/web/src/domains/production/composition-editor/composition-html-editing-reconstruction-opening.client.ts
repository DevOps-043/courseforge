import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_RECONSTRUCTION_OPENING_POLICY as policy, htmlReconstructionOpeningSchema,
  htmlReconstructionOpeningRequestSchema, matchesHtmlReconstructionOpening, type HtmlReconstructionOpeningRequest } from "./composition-html-editing-reconstruction-opening.contract";

const envelope = z.object({success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlReconstructionOpeningSchema}).strict();
/** Current identity read only. No receipt-as-authority, auto initialize, redirect,
 * document save, publication, retries or original-source reconciliation. */
export async function consultHtmlReconstructionOpening(input: {request: HtmlReconstructionOpeningRequest; signal: AbortSignal; fetcher?: typeof fetch}) {
  try {
    const request = htmlReconstructionOpeningRequestSchema.parse(input.request);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
    const query = new URLSearchParams({compositionId: request.compositionId});
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.draftId}/html-reconstruction-opening?${query}`,
      {method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal});
    if (response.status !== 200) throw new Error();
    const parsed = envelope.parse(await readBoundedCompositionJson(response, policy.responseBytes + 1024, signal));
    signal.throwIfAborted();
    if (parsed.requestId !== parsed.correlationId || !matchesHtmlReconstructionOpening(parsed.data, request)) throw new Error();
    return parsed.data;
  } catch {input.signal.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_OPENING_UNAVAILABLE");}
}
