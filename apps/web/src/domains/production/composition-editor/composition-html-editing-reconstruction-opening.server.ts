import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_RECONSTRUCTION_OPENING_POLICY as policy, htmlReconstructionOpeningRequestSchema, htmlReconstructionOpeningSchema,
  matchesHtmlReconstructionOpening, type HtmlReconstructionOpeningRequest } from "./composition-html-editing-reconstruction-opening.contract";

/** Service-only authorized identity reader. No create/getOrCreate/initialize,
 * source acquisition, HTML compiler, ZIP, signing, writes or automatic retries. */
export async function readAuthorizedHtmlReconstructionOpening(input: {request: HtmlReconstructionOpeningRequest;
  supabase: SupabaseClient; signal?: AbortSignal}) {
  const request = htmlReconstructionOpeningRequestSchema.parse(input.request), parent = input.signal;
  const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(policy.timeoutMs)]) : AbortSignal.timeout(policy.timeoutMs);
  try {
    signal.throwIfAborted();
    const result = await input.supabase.rpc("read_html_reconstruction_opening", {p_org: request.organizationId,
      p_actor: request.actorId, p_composition: request.compositionId, p_draft: request.draftId}).abortSignal(signal);
    signal.throwIfAborted();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > policy.responseBytes) throw new Error();
    const opening = htmlReconstructionOpeningSchema.parse(result.data);
    if (!matchesHtmlReconstructionOpening(opening, request)) throw new Error();
    return opening;
  } catch {parent?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_OPENING_UNAVAILABLE");}
}
