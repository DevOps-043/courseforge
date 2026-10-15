import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_LEGACY_ADOPTION_POLICY as policy, htmlLegacyAdoptionReadSchema, type HtmlLegacyAdoptionCommand,
  type HtmlLegacyAdoptionReceipt } from "./composition-html-editing-legacy-adoption.contract";
import { HTML_LEGACY_ADOPTION_HTTP_POLICY } from "./composition-html-editing-legacy-adoption-http-policy";
import { encodeHtmlLegacyAdoptionCommand } from "./composition-html-editing-legacy-adoption-request";

const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlLegacyAdoptionReadSchema }).strict();
const responseOverheadBytes = 1024;
type Input = { command: HtmlLegacyAdoptionCommand; requestSha256: string; signal?: AbortSignal; fetcher?: typeof fetch };
export class HtmlLegacyAdoptionClientError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "INVALID_REQUEST" | "READ_UNAVAILABLE" | "OUTCOME_UNKNOWN") {
    super(`HTML_LEGACY_ADOPTION_${code}`); this.name = "HtmlLegacyAdoptionClientError";
  }
}
export async function computeHtmlLegacyAdoptionRequestSha256InBrowser(input: unknown) {
  const encoded = encodeHtmlLegacyAdoptionCommand(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encoded.preimage));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Correlation/integrity only. A local digest or receipt never grants authority. */
export async function matchesHtmlLegacyAdoptionReceipt(command: HtmlLegacyAdoptionCommand, requestSha256: string, receipt: HtmlLegacyAdoptionReceipt) {
  const encoded = encodeHtmlLegacyAdoptionCommand(command);
  return receipt.owner.actorId === encoded.command.actorId && receipt.owner.organizationId === encoded.command.organizationId
    && receipt.owner.draftId === encoded.command.documentId && receipt.clipId === encoded.command.clipId
    && receipt.operationId === encoded.command.operationId && receipt.requestSha256 === requestSha256
    && JSON.stringify(receipt.request) === encoded.canonical
    && await computeHtmlLegacyAdoptionRequestSha256InBrowser(encoded.command) === requestSha256;
}
async function perform(input: Input, method: "GET" | "POST") {
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_LEGACY_ADOPTION_HTTP_POLICY.timeoutMs)])
    : AbortSignal.timeout(HTML_LEGACY_ADOPTION_HTTP_POLICY.timeoutMs);
  let encoded: ReturnType<typeof encodeHtmlLegacyAdoptionCommand>, url: string;
  try {
    signal.throwIfAborted();
    encoded = encodeHtmlLegacyAdoptionCommand(input.command);
    if (!/^[a-f0-9]{64}$/.test(input.requestSha256)
      || await computeHtmlLegacyAdoptionRequestSha256InBrowser(encoded.command) !== input.requestSha256) throw new Error();
    const command = encoded.command;
    url = `/api/production/hyperframes/drafts/${command.documentId}/html-editing/${command.clipId}/adopt/operations/${command.operationId}`;
    if (method === "GET") url += `?${new URLSearchParams({ ...command.request, requestSha256: input.requestSha256 })}`;
    if (new TextEncoder().encode(url).byteLength > HTML_LEGACY_ADOPTION_HTTP_POLICY.maximumUrlBytes) throw new Error();
    signal.throwIfAborted();
  } catch { throw new HtmlLegacyAdoptionClientError("INVALID_REQUEST"); }
  try {
    signal.throwIfAborted();
    const response = await (input.fetcher ?? fetch)(url, { method, credentials: "same-origin", redirect: "error", cache: "no-store",
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: encoded.canonical } : {}), signal });
    if (response.status !== 200) throw new Error();
    const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, policy.receiptBytes + responseOverheadBytes, signal));
    signal.throwIfAborted();
    if (envelope.requestId !== envelope.correlationId) throw new Error();
    if (envelope.data.status === "RECORDED") {
      if (new TextEncoder().encode(JSON.stringify(envelope.data.receipt)).byteLength > policy.receiptBytes
        || !await matchesHtmlLegacyAdoptionReceipt(encoded.command, input.requestSha256, envelope.data.receipt)) throw new Error();
    } else if (method === "POST") throw new Error();
    signal.throwIfAborted();
    return envelope.data;
  } catch { throw new HtmlLegacyAdoptionClientError(method === "POST" ? "OUTCOME_UNKNOWN" : "READ_UNAVAILABLE"); }
}
/** One explicit POST. Caller journals under the shared draft lock before dispatch. */
export async function sendHtmlLegacyAdoptionOperation(input: Input) {
  const result = await perform(input, "POST");
  if (result.status !== "RECORDED") throw new HtmlLegacyAdoptionClientError("OUTCOME_UNKNOWN");
  return result.receipt;
}
/** One GET, including after a stored ACK. NOT_FOUND cannot authorize retry/closure. */
export function consultHtmlLegacyAdoptionOperation(input: Input) { return perform(input, "GET"); }
