import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_INITIAL_ANCHOR_POLICY as policy, htmlInitialAnchorRequestSchema, htmlInitialAnchorViewSchema } from "./composition-html-initial-anchor.contract";

const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(), data: htmlInitialAnchorViewSchema }).strict();
/** Exactly one explicit request. GET availability never proves the outcome of
 * an earlier POST, nor registers fields. Never automatically retries a write. */
export async function requestHtmlInitialAnchor(input: { documentId: string; expectedDocumentHash: string;
  action: "CONSULT" | "PREPARE"; signal: AbortSignal; fetcher?: typeof fetch }) {
  const documentId = z.string().uuid().parse(input.documentId);
  const body = htmlInitialAnchorRequestSchema.parse({ expectedDocumentHash: input.expectedDocumentHash });
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
  const query = input.action === "CONSULT" ? `?${new URLSearchParams(body)}` : "";
  const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${documentId}/html-editing-initial-anchor${query}`, {
    method: input.action === "CONSULT" ? "GET" : "POST", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    ...(input.action === "PREPARE" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  signal.throwIfAborted();
  if (response.status !== 200) throw new Error(response.status === 409 ? "HTML_INITIAL_ANCHOR_CONFLICT" : "HTML_INITIAL_ANCHOR_UNAVAILABLE");
  const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, policy.responseBytes, signal));
  signal.throwIfAborted();
  if (envelope.requestId !== envelope.correlationId || envelope.data.documentId !== documentId || envelope.data.documentHash !== body.expectedDocumentHash)
    throw new Error("HTML_INITIAL_ANCHOR_UNAVAILABLE");
  return envelope.data;
}
