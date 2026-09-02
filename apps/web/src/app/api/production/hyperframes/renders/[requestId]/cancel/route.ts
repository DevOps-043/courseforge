import { NextResponse } from "next/server";
import { z } from "zod";
import { HyperframesRenderDiagnosticsService } from "@/domains/production/hyperframes/hyperframes-render-diagnostics.service";
import { resolveAuthorizedRenderContext } from "../../_render-route-support";

export async function POST(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const requestId = z.string().uuid().parse((await context.params).requestId);
    const auth = await resolveAuthorizedRenderContext();
    if (auth.response) return auth.response;
    const status = await new HyperframesRenderDiagnosticsService(auth.admin).cancel(auth.organizationId, requestId);
    if (!status) return NextResponse.json({ error: "Render no encontrado." }, { status: 404 });
    if (status !== "CANCELLED") return NextResponse.json({ error: "El proceso ya terminó. Actualiza su estado.", status }, { status: 409 });
    return NextResponse.json({ status, message: "Proceso cancelado en Courseforge. HeyGen puede continuar el cómputo ya aceptado." });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    console.error("[Render cancellation]", error instanceof Error ? error.name : "Database error");
    return NextResponse.json({ error: "No se pudo cancelar el proceso. Actualiza el estado antes de reintentar." }, { status: 500 });
  }
}
