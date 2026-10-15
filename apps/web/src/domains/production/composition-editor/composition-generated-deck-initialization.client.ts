import { z } from "zod";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope } from "./composition-html-snapshot-locator.client";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { GENERATED_DECK_INITIALIZATION_POLICY, generatedDeckInitializationRequestSchema, generatedDeckInitializationRequestPreimage,
  generatedDeckInitializationReadSchema, generatedDeckInitializationReceiptSchema, generatedDeckInitializationCurrentSchema,
  type GeneratedDeckInitializationRequest, type GeneratedDeckInitializationReceipt } from "./composition-generated-deck-initialization.contract";

const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(), data: z.unknown() }).strict();
const identitySchema = generatedDeckInitializationRequestSchema.omit({ expectedDocumentHash: true });
export async function computeGeneratedDeckInitializationRequestSha256InBrowser(expectedDocumentHash: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(generatedDeckInitializationRequestPreimage(expectedDocumentHash)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function request(input: { scope: HtmlSnapshotLocatorScope; url: string; method: "GET" | "POST";
  body?: GeneratedDeckInitializationRequest; signal: AbortSignal; fetcher?: typeof fetch }) {
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(GENERATED_DECK_INITIALIZATION_POLICY.timeoutMs)]);
  signal.throwIfAborted();
  const response = await (input.fetcher ?? fetch)(input.url, { method: input.method, credentials: "same-origin",
    redirect: "error", cache: "no-store", signal,
    ...(input.body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.body) } : {}) });
  const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, GENERATED_DECK_INITIALIZATION_POLICY.maximumReceiptBytes + 1024, signal));
  signal.throwIfAborted();
  if (envelope.requestId !== envelope.correlationId) throw new Error("GENERATED_DECK_UNCORRELATED");
  return envelope.data;
}
async function verifyReceipt(scope: HtmlSnapshotLocatorScope, identity: z.infer<typeof identitySchema>, receipt: GeneratedDeckInitializationReceipt) {
  if (receipt.owner.actorId !== scope.actorId || receipt.owner.organizationId !== scope.organizationId || receipt.owner.draftId !== scope.draftId
    || receipt.operationId !== identity.operationId || receipt.requestSha256 !== identity.requestSha256
    || await computeGeneratedDeckInitializationRequestSha256InBrowser(receipt.expectedDocumentHash) !== receipt.requestSha256)
    throw new Error("GENERATED_DECK_RECEIPT_UNVERIFIED");
}
function endpoint(scope: HtmlSnapshotLocatorScope) { return `/api/production/hyperframes/drafts/${scope.draftId}/generated-deck-initialization`; }
export async function sendGeneratedDeckInitialization(input: { scope: HtmlSnapshotLocatorScope; body: GeneratedDeckInitializationRequest; signal: AbortSignal; fetcher?: typeof fetch }) {
  const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), body = generatedDeckInitializationRequestSchema.parse(input.body);
  if (await computeGeneratedDeckInitializationRequestSha256InBrowser(body.expectedDocumentHash) !== body.requestSha256)
    throw new Error("GENERATED_DECK_REQUEST_UNVERIFIED");
  const receipt = generatedDeckInitializationReceiptSchema.parse(await request({ ...input, scope, body, url: endpoint(scope), method: "POST" }));
  await verifyReceipt(scope, body, receipt);
  if (receipt.expectedDocumentHash !== body.expectedDocumentHash) throw new Error("GENERATED_DECK_RECEIPT_UNVERIFIED");
  input.signal.throwIfAborted(); return receipt;
}
export async function consultGeneratedDeckInitialization(input: { scope: HtmlSnapshotLocatorScope; identity: z.infer<typeof identitySchema>; signal: AbortSignal; fetcher?: typeof fetch }) {
  const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), identity = identitySchema.parse(input.identity);
  const result = generatedDeckInitializationReadSchema.parse(await request({ ...input, scope, url: `${endpoint(scope)}?${new URLSearchParams(identity)}`, method: "GET" }));
  if (result.status === "RECORDED") await verifyReceipt(scope, identity, result.receipt);
  input.signal.throwIfAborted(); return result;
}
export async function consultCurrentGeneratedDeckInitialization(input: { scope: HtmlSnapshotLocatorScope; identity: z.infer<typeof identitySchema>; documentHash: string; signal: AbortSignal; fetcher?: typeof fetch }) {
  const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope), identity = identitySchema.parse(input.identity);
  const documentHash = z.string().regex(/^[a-f0-9]{64}$/).parse(input.documentHash);
  const result = generatedDeckInitializationCurrentSchema.parse(await request({ ...input, scope,
    url: `${endpoint(scope)}/current?${new URLSearchParams({ ...identity, documentHash })}`, method: "GET" }));
  await verifyReceipt(scope, identity, result.receipt);
  if (result.documentHash !== documentHash) throw new Error("GENERATED_DECK_CURRENT_UNVERIFIED");
  input.signal.throwIfAborted(); return result;
}
