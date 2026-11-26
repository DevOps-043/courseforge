import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_INITIAL_ANCHOR_POLICY as policy, htmlInitialAnchorRequestSchema, htmlInitialAnchorViewSchema } from "./composition-html-initial-anchor.contract";

const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(), data: htmlInitialAnchorViewSchema }).strict();
export class HtmlInitialAnchorClientError extends Error {
  constructor(readonly status: number, readonly requestId: string | null) {
    super(status === 409 ? "HTML_INITIAL_ANCHOR_CONFLICT" : "HTML_INITIAL_ANCHOR_UNAVAILABLE");
    this.name = "HtmlInitialAnchorClientError";
  }
}

/** Diagnóstico seguro: nunca muestra el cuerpo ni mensajes internos del proveedor. */
export function describeHtmlInitialAnchorFailure(error: unknown) {
  if (!(error instanceof HtmlInitialAnchorClientError)) return "No se pudo comprobar la revisión guardada. Consulta su disponibilidad antes de volver a preparar los campos.";
  const message = error.status === 409 ? "El borrador cambió o su duración requiere revisión. Recarga la composición y, si falta su origen, recalcula la duración antes de continuar."
    : error.status === 401 || error.status === 403 ? "No se pudo autorizar la preparación. Revisa tu sesión y acceso al curso."
      : error.status === 429 ? "Se alcanzó el límite de consultas. Espera un minuto antes de volver a comprobar."
        : "El servicio de preparación no está disponible. Revisa el diagnóstico del servidor antes de volver a preparar los campos.";
  return error.requestId ? `${message} Referencia: ${error.requestId}.` : message;
}
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
  if (response.status !== 200) {
    const requestId = z.string().uuid().safeParse(response.headers.get("x-request-id"));
    await response.body?.cancel().catch(() => undefined);
    throw new HtmlInitialAnchorClientError(response.status, requestId.success ? requestId.data : null);
  }
  const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, policy.responseBytes, signal));
  signal.throwIfAborted();
  if (envelope.requestId !== envelope.correlationId || envelope.data.documentId !== documentId || envelope.data.documentHash !== body.expectedDocumentHash)
    throw new Error("HTML_INITIAL_ANCHOR_UNAVAILABLE");
  return envelope.data;
}
