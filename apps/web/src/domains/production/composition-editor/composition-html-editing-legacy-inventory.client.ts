import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_LEGACY_INVENTORY_POLICY as policy, htmlLegacyInventoryRequestSchema, htmlLegacyInventoryPageSchema,
  matchesHtmlLegacyInventoryPage, type HtmlLegacyInventoryRequest } from "./composition-html-editing-legacy-inventory.contract";

const envelopeSchema = z.object({success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlLegacyInventoryPageSchema}).strict();
/** Metadata only, one explicit GET. Owner is a local correlation input, never
 * serialized as authority. No source execution, install, retry or write. */
export async function consultHtmlLegacyInventory(input: {request: HtmlLegacyInventoryRequest; signal: AbortSignal; fetcher?: typeof fetch}) {
  try {
    const request = htmlLegacyInventoryRequestSchema.parse(input.request);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
    const query = new URLSearchParams({compositionId: request.query.compositionId});
    if (request.query.afterOrdinal !== undefined) {
      query.set("afterOrdinal", String(request.query.afterOrdinal)); query.set("expectedDocumentHash", request.query.expectedDocumentHash!);
      query.set("expectedVersion", String(request.query.expectedVersion));
    }
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.draftId}/html-legacy-inventory?${query}`,
      {method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal});
    signal.throwIfAborted();
    if (response.status === 409) throw new Error("HTML_LEGACY_INVENTORY_BASE_CHANGED");
    if (response.status !== 200) throw new Error();
    const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, policy.responseBytes + 1024, signal)); signal.throwIfAborted();
    if (envelope.requestId !== envelope.correlationId || !matchesHtmlLegacyInventoryPage(envelope.data, request)) throw new Error();
    return envelope.data;
  } catch (error) {
    input.signal.throwIfAborted();
    throw new Error(error instanceof Error && error.message === "HTML_LEGACY_INVENTORY_BASE_CHANGED"
      ? "El borrador cambió. Reinicia el inventario antes de continuar."
      : "No se pudo consultar el inventario autorizado. No se modificó ni ejecutó contenido.");
  }
}
