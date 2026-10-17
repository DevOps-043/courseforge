import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_RECONSTRUCTION_LIBRARY_POLICY as policy, htmlReconstructionLibraryQuerySchema, htmlReconstructionLibraryPageSchema,
  type HtmlReconstructionLibraryPage } from "./composition-html-editing-reconstruction-library.contract";

const requestSchema = z.object({draftId: z.string().uuid(), query: htmlReconstructionLibraryQuerySchema}).strict();
const envelope = z.object({success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlReconstructionLibraryPageSchema}).strict();
export class HtmlReconstructionLibraryReadError extends Error {
  constructor(readonly baseChanged = false) {super(baseChanged ? "El borrador cambió. Actualiza la biblioteca antes de continuar."
    : "No se pudo consultar la biblioteca vinculada. No se importaron ni vincularon recursos.");}
}
/** One explicit GET; no tenant/actor in browser request, redirects or retries. */
export async function consultHtmlReconstructionLibrary(input: {request: z.infer<typeof requestSchema>;
  signal: AbortSignal; fetcher?: typeof fetch}): Promise<HtmlReconstructionLibraryPage> {
  try {
    const request = requestSchema.parse(input.request), signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]);
    signal.throwIfAborted();
    const query = new URLSearchParams({compositionId: request.query.compositionId});
    if (request.query.afterAssetId !== undefined) {
      query.set("afterAssetId", request.query.afterAssetId); query.set("expectedDocumentHash", request.query.expectedDocumentHash!);
      query.set("expectedVersion", String(request.query.expectedVersion));
    }
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.draftId}/html-reconstruction-library?${query}`,
      {method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal});
    signal.throwIfAborted();
    if (response.status === 409) throw new HtmlReconstructionLibraryReadError(true);
    if (response.status !== 200) throw new Error();
    const parsed = envelope.parse(await readBoundedCompositionJson(response, policy.responseBytes + 1024, signal)), page = parsed.data;
    signal.throwIfAborted();
    if (parsed.requestId !== parsed.correlationId || page.compositionId !== request.query.compositionId || page.draftId !== request.draftId
      || page.afterAssetId !== (request.query.afterAssetId ?? null)
      || (request.query.expectedDocumentHash !== undefined && page.currentDocumentHash !== request.query.expectedDocumentHash)
      || (request.query.expectedVersion !== undefined && page.currentVersion !== request.query.expectedVersion)) throw new Error();
    return page;
  } catch (error) {
    input.signal.throwIfAborted();
    if (error instanceof HtmlReconstructionLibraryReadError) throw error;
    throw new HtmlReconstructionLibraryReadError();
  }
}
