import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_HISTORICAL_PUBLICATION_HTTP_POLICY as policy } from "./composition-html-editing-historical-publication-http.contract";
import { htmlHistoricalPublicationCommandSchema, htmlHistoricalPublicationReadSchema,
  type HtmlHistoricalPublicationCommand, type HtmlHistoricalPublicationReceipt } from "./composition-html-editing-historical-publication.contract";
import { historicalHtmlPublicationRequestPreimage } from "./composition-html-editing-historical-publication-preimage";

const envelope = z.object({success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlHistoricalPublicationReadSchema}).strict();
export async function computeHistoricalHtmlPublicationDigest(command: HtmlHistoricalPublicationCommand) {
  const bytes = new TextEncoder().encode(historicalHtmlPublicationRequestPreimage(command));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function matchesHistoricalHtmlPublicationReceipt(command: HtmlHistoricalPublicationCommand,
  requestSha256: string, receipt: HtmlHistoricalPublicationReceipt) {
  return receipt.organizationId === command.organizationId && receipt.actorId === command.actorId
    && receipt.compositionId === command.compositionId && receipt.draftId === command.draftId
    && receipt.operationId === command.operationId && receipt.request.candidateId === command.request.candidateId
    && receipt.request.candidateSha256 === command.request.candidateSha256 && receipt.requestSha256 === requestSha256
    && await computeHistoricalHtmlPublicationDigest(command) === requestSha256;
}
type Input = {command: HtmlHistoricalPublicationCommand; requestSha256: string; signal: AbortSignal; fetcher?: typeof fetch};

/** One request only, never retry. SEND requires caller's durable journal first.
 * Receipt describes an inactive historical commit, not editor state to install. */
async function transfer(method: "GET" | "POST", input: Input) {
  try {
    const command = htmlHistoricalPublicationCommandSchema.parse(input.command);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
    if (await computeHistoricalHtmlPublicationDigest(command) !== input.requestSha256) throw new Error();
    signal.throwIfAborted();
    const body = {compositionId: command.compositionId, ...command.request};
    const query = method === "GET" ? `?${new URLSearchParams({...body, requestSha256: input.requestSha256})}` : "";
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${command.draftId}/html-historical-publications/${command.operationId}${query}`,
      {method, credentials: "same-origin", cache: "no-store", redirect: "error", signal,
        ...(method === "POST" ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {})});
    if (response.status !== 200) throw new Error();
    const result = envelope.parse(await readBoundedCompositionJson(response, policy.maximumResponseBytes + 1024, signal));
    if (result.requestId !== result.correlationId || method === "POST" && result.data.status !== "RECORDED") throw new Error();
    if (result.data.status === "RECORDED" && !await matchesHistoricalHtmlPublicationReceipt(command, input.requestSha256, result.data.receipt)) throw new Error();
    signal.throwIfAborted(); return result.data;
  } catch {throw new Error("HTML_HISTORICAL_PUBLICATION_OUTCOME_UNCONFIRMED");}
}
export async function sendHistoricalHtmlPublication(input: Input) {
  const result = await transfer("POST", input);
  if (result.status !== "RECORDED") throw new Error("HTML_HISTORICAL_PUBLICATION_OUTCOME_UNCONFIRMED");
  return result.receipt;
}
export function consultHistoricalHtmlPublication(input: Input) {return transfer("GET", input);}
