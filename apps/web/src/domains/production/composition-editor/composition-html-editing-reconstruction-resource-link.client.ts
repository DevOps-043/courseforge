import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_RECONSTRUCTION_RESOURCE_LINK_POLICY as policy, htmlReconstructionResourceLookupRequestSchema,
  htmlReconstructionResourceCandidateSchema, htmlReconstructionResourceLinkCommandSchema, htmlReconstructionResourceLinkReadSchema,
  htmlReconstructionResourceLinkPreimage, matchesHtmlReconstructionResourceLinkReceipt,
  type HtmlReconstructionResourceLookupRequest, type HtmlReconstructionResourceLinkCommand } from "./composition-html-editing-reconstruction-resource-link.contract";

const responseOwner = {success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid()};
const candidateEnvelope = z.object({...responseOwner, data: htmlReconstructionResourceCandidateSchema}).strict();
const linkEnvelope = z.object({...responseOwner, data: htmlReconstructionResourceLinkReadSchema}).strict();
export async function computeHtmlReconstructionResourceLinkDigest(command: HtmlReconstructionResourceLinkCommand) {
  const bytes = new TextEncoder().encode(htmlReconstructionResourceLinkPreimage(command));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Explicit lookup only; neither metadata nor a returned pin is permission to
 * skip current SQL checks at attachment or subsequent native/HTML editing. */
export async function consultHtmlReconstructionResource(input: {request: HtmlReconstructionResourceLookupRequest;
  signal: AbortSignal; fetcher?: typeof fetch}) {
  try {
    const request = htmlReconstructionResourceLookupRequestSchema.parse(input.request), signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]);
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.draftId}/html-reconstruction-resources/${request.query.assetId}?compositionId=${request.query.compositionId}`,
      {method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal});
    if (response.status !== 200) throw new Error();
    const result = candidateEnvelope.parse(await readBoundedCompositionJson(response, policy.responseBytes + 1024, signal)); signal.throwIfAborted();
    if (result.requestId !== result.correlationId || result.data.organizationId !== request.organizationId
      || result.data.compositionId !== request.query.compositionId || result.data.draftId !== request.draftId
      || result.data.asset.productionAssetId !== request.query.assetId) throw new Error();
    return result.data;
  } catch {input.signal.throwIfAborted(); throw new Error("No se pudo verificar el medio de esta empresa. No se vinculó ningún recurso.");}
}
/** One dispatch/read, no retries. GET NOT_FOUND never triggers POST. A receipt
 * proves only this link operation, not current resource status or native state. */
export async function requestHtmlReconstructionResourceLink(input: {command: HtmlReconstructionResourceLinkCommand;
  mode: "LINK" | "READ"; signal: AbortSignal; fetcher?: typeof fetch}) {
  try {
    const command = htmlReconstructionResourceLinkCommandSchema.parse(input.command), digest = await computeHtmlReconstructionResourceLinkDigest(command);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
    const body = {...command.request, compositionId: command.compositionId};
    const query = new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)]));
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${command.draftId}/html-reconstruction-resource-links/${command.operationId}${input.mode === "READ" ? `?${query}` : ""}`,
      {method: input.mode === "READ" ? "GET" : "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
        ...(input.mode === "LINK" ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {})});
    if (response.status !== 200) throw new Error();
    const result = linkEnvelope.parse(await readBoundedCompositionJson(response, policy.responseBytes + 1024, signal)); signal.throwIfAborted();
    if (result.requestId !== result.correlationId || input.mode === "LINK" && result.data.status !== "RECORDED"
      || result.data.status === "RECORDED" && !matchesHtmlReconstructionResourceLinkReceipt(result.data.receipt, command, digest)) throw new Error();
    return result.data;
  } catch {throw new Error("Resultado sin confirmar. Conserva el seguimiento y consulta el recibo; no repitas el envío.");}
}
