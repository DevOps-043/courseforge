import { NextResponse } from "next/server";
import { z } from "zod";
import { HyperframesRenderDiagnosticsService } from "@/domains/production/hyperframes/hyperframes-render-diagnostics.service";
import { resolveAuthorizedRenderContext } from "../../_render-route-support";

export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  try {
    const requestId = z.string().uuid().parse((await context.params).requestId);
    const auth = await resolveAuthorizedRenderContext();
    if (auth.response) return auth.response;
    const data = await new HyperframesRenderDiagnosticsService(auth.admin).read(auth.organizationId, requestId);
    return NextResponse.json(data ? { data } : { error: "Render no encontrado." }, {
      status: data ? 200 : 404, headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador inválido." }, { status: 400 });
    console.error("[Render diagnostics]", error instanceof Error ? error.name : "Database error");
    return NextResponse.json({ error: "No se pudo leer el diagnóstico del render. Comprueba la conexión y la migración de diagnósticos." }, { status: 500 });
  }
}
