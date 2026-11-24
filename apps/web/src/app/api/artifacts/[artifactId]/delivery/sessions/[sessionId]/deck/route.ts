import { z } from "zod";
import { DeliveryAccessError } from "@/domains/course-delivery/services/delivery-access";
import { sessionDeckAccess, readSessionDeck, produceSessionDeck, SessionDeckError } from "@/domains/course-delivery/services/delivery-deck.server";
import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { parseJsonRequest } from "@/lib/server/api-contract";

export const runtime = "nodejs";
type Context = { params: Promise<{ artifactId: string; sessionId: string }> };
const headers = { "Cache-Control": "private, no-store" };
async function accessFor(context: Context) {
  const { artifactId, sessionId } = await context.params;
  return sessionDeckAccess(z.uuid().parse(artifactId), z.uuid().parse(sessionId));
}
function failure(error: unknown, requestId: string) {
  const unavailable = authorizationUnavailableResponse(error, requestId);
  if (unavailable) return unavailable;
  const known = error instanceof SessionDeckError || error instanceof DeliveryAccessError;
  const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
  createOperationalLogger("imparticion.presentacion", { requestId }).warn("presentacion_rechazada", { name: error instanceof Error ? error.name : "Error", status: known ? error.status : invalid ? 400 : 500 });
  return Response.json({ message: known ? error.message : invalid ? "Solicitud inválida." : "No se pudo preparar la presentación." },
    { status: known ? error.status : invalid ? 400 : 500, headers });
}
export async function GET(request: Request, context: Context) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const saved = await readSessionDeck(await accessFor(context));
    const url = new URL(request.url);
    if (!url.searchParams.has("preview") && !url.searchParams.has("download"))
      return Response.json({ deck: saved?.result || null }, { headers });
    if (!saved) throw new SessionDeckError("La presentación aún no se ha producido.", 404);
    if (saved.result.status !== "READY") throw new SessionDeckError("La presentación tiene errores de QA. Revisa el diagnóstico antes de utilizarla.", 422);
    return new Response(saved.html, { headers: { ...headers,
      "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      ...(url.searchParams.has("download") ? { "Content-Disposition": `attachment; filename="presentacion-${saved.result.id}.html"` } : {}),
    } });
  } catch (error) { return failure(error, requestId); }
}
export async function POST(request: Request, context: Context) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    // Solo se acepta la revisión; el cliente no suministra contenido ni autoridad.
    const parsed = await parseJsonRequest(request, z.object({ revision: z.number().int().nonnegative() }).strict(), 128);
    if (!parsed.success) return Response.json({ message: "Solicitud inválida." }, { status: parsed.reason === "too_large" ? 413 : 400, headers });
    const { revision } = parsed.data;
    return Response.json({ deck: await produceSessionDeck(await accessFor(context), revision) }, { headers });
  } catch (error) { return failure(error, requestId); }
}
