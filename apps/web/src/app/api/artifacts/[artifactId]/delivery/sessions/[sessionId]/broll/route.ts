import { z } from "zod";
import { sessionBrollCommandSchema } from "@/domains/course-delivery/types/session-broll";
import { sessionBrollAccess, listSessionBrolls, commandSessionBroll, sessionBrollMedia } from "@/domains/course-delivery/services/session-broll.server";
import { SessionDeckError } from "@/domains/course-delivery/services/delivery-deck.server";
import { DeliveryAccessError } from "@/domains/course-delivery/services/delivery-access";
import { parseJsonRequest } from "@/lib/server/api-contract";
import { authorizationUnavailableResponse } from "@/lib/server/authorization-unavailable-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ artifactId: string; sessionId: string }> };
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
async function accessFor(context: Context) {
  const { artifactId, sessionId } = await context.params;
  return sessionBrollAccess(z.uuid().parse(artifactId), z.uuid().parse(sessionId));
}
function failure(error: unknown, requestId: string) {
  const unavailable = authorizationUnavailableResponse(error, requestId);
  if (unavailable) return unavailable;
  const known = error instanceof SessionDeckError || error instanceof DeliveryAccessError;
  const status = known ? error.status : error instanceof z.ZodError ? 400 : 500;
  createOperationalLogger("imparticion.broll", { requestId }).warn("apoyo_rechazado", { status, name: error instanceof Error ? error.name : "Error" });
  return Response.json({ message: known ? error.message : status === 400 ? "Solicitud inválida." : "No se pudo completar la operación del clip." }, { status, headers });
}
export async function GET(request: Request, context: Context) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const access = await accessFor(context);
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId");
    if (assetId) return new Response(null, { status: 302, headers: { ...headers, Location: await sessionBrollMedia(access, z.uuid().parse(assetId)) } });
    const after = url.searchParams.get("after");
    return Response.json(await listSessionBrolls(access, after ? z.uuid().parse(after) : undefined), { headers });
  } catch (error) { return failure(error, requestId); }
}
export async function POST(request: Request, context: Context) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const parsed = await parseJsonRequest(request, sessionBrollCommandSchema, 2048);
    if (!parsed.success) return Response.json({ message: "Solicitud de apoyo inválida." }, { status: parsed.reason === "too_large" ? 413 : 400, headers });
    return Response.json(await commandSessionBroll(await accessFor(context), parsed.data), { headers });
  } catch (error) { return failure(error, requestId); }
}
