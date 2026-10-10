import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_RECONSTRUCTION_LIBRARY_POLICY as policy, htmlReconstructionLibraryRequestSchema,
  htmlReconstructionLibraryPageSchema, matchesHtmlReconstructionLibrary, type HtmlReconstructionLibraryRequest } from "./composition-html-editing-reconstruction-library.contract";

export class HtmlReconstructionLibraryConflict extends Error {
  constructor() {super("HTML_RECONSTRUCTION_LIBRARY_BASE_CHANGED");}
}
/** One bounded service-only RPC: current opening authorization and linked resource
 * metadata are read together under the existing draft-first shared locks.
 * No Storage locations, signing, import, linking, source compilation or retries. */
export async function readAuthorizedHtmlReconstructionLibrary(input: {request: HtmlReconstructionLibraryRequest;
  supabase: SupabaseClient; signal?: AbortSignal}) {
  const request = htmlReconstructionLibraryRequestSchema.parse(input.request), parent = input.signal;
  const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(policy.timeoutMs)]) : AbortSignal.timeout(policy.timeoutMs);
  try {
    signal.throwIfAborted();
    const result = await input.supabase.rpc("read_html_reconstruction_library", {p_org: request.organizationId,
      p_actor: request.actorId, p_composition: request.query.compositionId, p_draft: request.draftId,
      p_after_asset: request.query.afterAssetId ?? null, p_expected_hash: request.query.expectedDocumentHash ?? null,
      p_expected_version: request.query.expectedVersion ?? null}).abortSignal(signal);
    signal.throwIfAborted();
    if (result.error?.message === "HTML_RECONSTRUCTION_LIBRARY_BASE_CHANGED") throw new HtmlReconstructionLibraryConflict();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > policy.responseBytes) throw new Error();
    const page = htmlReconstructionLibraryPageSchema.parse(result.data);
    if (!matchesHtmlReconstructionLibrary(page, request)) throw new Error();
    return page;
  } catch (error) {
    parent?.throwIfAborted();
    if (error instanceof HtmlReconstructionLibraryConflict) throw error;
    throw new Error("HTML_RECONSTRUCTION_LIBRARY_UNAVAILABLE");
  }
}
