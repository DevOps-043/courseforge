import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { HTML_TEMPLATE_CHOICES_POLICY as policy, htmlTemplateChoicesQuerySchema,
  htmlTemplateChoicesViewSchema } from "./composition-html-editing-template-choices.contract";

const requestSchema = htmlEditingBindingSchema.pick({ documentId: true, clipId: true })
  .extend(htmlTemplateChoicesQuerySchema.shape).strict();
const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlTemplateChoicesViewSchema }).strict();
/** Explicit metadata GET, no HTML/manifest/grants, registration, retry or fallback. */
export async function consultHtmlTemplateChoices(input: { request: z.infer<typeof requestSchema>;
  signal: AbortSignal; fetcher?: typeof fetch }) {
  try {
    const request = requestSchema.parse(input.request);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]); signal.throwIfAborted();
    const query = new URLSearchParams({ expectedDocumentHash: request.expectedDocumentHash });
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.documentId}/html-editing/${request.clipId}/templates?${query}`,
      { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
    signal.throwIfAborted();
    if (response.status === 409) throw new Error("HTML_TEMPLATE_CHOICES_BASE_CHANGED");
    if (response.status !== 200) throw new Error();
    const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, policy.responseBytes + 1024, signal));
    signal.throwIfAborted();
    if (envelope.requestId !== envelope.correlationId || envelope.data.documentId !== request.documentId
      || envelope.data.clipId !== request.clipId || envelope.data.documentHash !== request.expectedDocumentHash) throw new Error();
    return envelope.data;
  } catch (error) {
    input.signal.throwIfAborted();
    throw new Error(error instanceof Error && error.message === "HTML_TEMPLATE_CHOICES_BASE_CHANGED"
      ? "El borrador cambió. Recarga la composición antes de consultar plantillas."
      : "No se pudo consultar el catálogo instalado. No se inicializó ni modificó contenido.");
  }
}
