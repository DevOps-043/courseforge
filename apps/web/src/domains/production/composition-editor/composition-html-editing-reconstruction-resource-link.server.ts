import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_RECONSTRUCTION_RESOURCE_LINK_POLICY as policy, htmlReconstructionResourceCandidateSchema,
  htmlReconstructionResourceLookupRequestSchema, htmlReconstructionResourceLinkCommandSchema, htmlReconstructionResourceLinkReceiptSchema,
  htmlReconstructionResourceLinkReadSchema, htmlReconstructionResourceLinkPreimage, matchesHtmlReconstructionResourceLinkReceipt,
  type HtmlReconstructionResourceLookupRequest, type HtmlReconstructionResourceLinkCommand } from "./composition-html-editing-reconstruction-resource-link.contract";

export class HtmlReconstructionResourceLinkError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "CONFLICT" | "UNAVAILABLE" | "UNCONFIRMED") {super(`HTML_RECONSTRUCTION_RESOURCE_LINK_${code}`);}
}
/** Current tenant asset lookup, not attachment. No bytes/URLs/HTML acquisition. */
export async function readAuthorizedHtmlReconstructionResource(input: {supabase: SupabaseClient;
  request: HtmlReconstructionResourceLookupRequest; signal: AbortSignal}) {
  const request = htmlReconstructionResourceLookupRequestSchema.parse(input.request);
  try {
    input.signal.throwIfAborted();
    const result = await input.supabase.rpc("read_html_reconstruction_resource_candidate", {p_org: request.organizationId, p_actor: request.actorId,
      p_composition: request.query.compositionId, p_draft: request.draftId, p_asset: request.query.assetId}).abortSignal(input.signal);
    input.signal.throwIfAborted();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > policy.responseBytes) throw new Error();
    const candidate = htmlReconstructionResourceCandidateSchema.parse(result.data);
    if (candidate.organizationId !== request.organizationId || candidate.compositionId !== request.query.compositionId
      || candidate.draftId !== request.draftId || candidate.asset.productionAssetId !== request.query.assetId) throw new Error();
    return candidate;
  } catch {input.signal.throwIfAborted(); throw new HtmlReconstructionResourceLinkError("UNAVAILABLE");}
}
/** One atomic RPC, without retries. Receipt recovery is a separate current-access
 * read, never resource signing, linking again or native version adoption. */
export async function operateHtmlReconstructionResourceLink(input: {supabase: SupabaseClient; command: HtmlReconstructionResourceLinkCommand;
  signal: AbortSignal; mode: "LINK" | "READ"}) {
  const command = htmlReconstructionResourceLinkCommandSchema.parse(input.command);
  const digest = createHash("sha256").update(htmlReconstructionResourceLinkPreimage(command)).digest("hex");
  try {
    input.signal.throwIfAborted();
    const result = await input.supabase.rpc(input.mode === "LINK" ? "link_html_reconstruction_resource" : "read_html_reconstruction_resource_link",
      {p_org: command.organizationId, p_actor: command.actorId, p_composition: command.compositionId, p_draft: command.draftId,
        p_operation: command.operationId, p_request: command.request, p_request_sha256: digest}).abortSignal(input.signal);
    input.signal.throwIfAborted();
    if (result.error?.message === "HTML_RECONSTRUCTION_RESOURCE_LINK_CONFLICT") throw new HtmlReconstructionResourceLinkError("CONFLICT");
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > policy.responseBytes) throw new Error();
    const read = input.mode === "LINK" ? {status: "RECORDED" as const, receipt: htmlReconstructionResourceLinkReceiptSchema.parse(result.data)}
      : htmlReconstructionResourceLinkReadSchema.parse(result.data);
    if (read.status === "RECORDED" && !matchesHtmlReconstructionResourceLinkReceipt(read.receipt, command, digest)) throw new Error();
    return read;
  } catch (error) {
    if (error instanceof HtmlReconstructionResourceLinkError) throw error;
    throw new HtmlReconstructionResourceLinkError(input.mode === "LINK" ? "UNCONFIRMED" : "UNAVAILABLE");
  }
}
