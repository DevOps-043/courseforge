import { z } from "zod";
import { requireDeliveryAccess, DeliveryAccessError } from "@/domains/course-delivery/services/delivery-access";
import { readDeliveryContext, readDeliveryWorkspace } from "@/domains/course-delivery/services/delivery-repository";
import { deliveryReadiness } from "@/domains/course-delivery/services/delivery-readiness";
import { renderDeliveryExport } from "@/domains/course-delivery/services/delivery-export";

export async function GET(request: Request, context: { params: Promise<{ artifactId: string }> }) {
  try {
    const { artifactId } = await context.params;
    const url = new URL(request.url);
    const audience = z.enum(["participant", "facilitator", "presentation"]).parse(url.searchParams.get("audience"));
    z.uuid().parse(artifactId);
    const { admin, tenant } = await requireDeliveryAccess(artifactId);
    const workspace = await readDeliveryWorkspace(admin, artifactId, tenant.organizationId);
    const course = await readDeliveryContext(admin, artifactId, tenant.organizationId);
    const draft = url.searchParams.get("draft") === "1";
    if (workspace.document.config.mode === "NEXUS") return new Response("El curso utiliza publicación Nexus.", { status: 409 });
    if (!draft && !deliveryReadiness(workspace.document, course).materialsReady) return new Response("Aprueba los materiales vigentes antes de preparar la entrega.", { status: 409 });
    const html = renderDeliveryExport(workspace, course, audience, draft);
    return new Response(html, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "Referrer-Policy": "no-referrer",
      ...(url.searchParams.get("download") === "1" ? { "Content-Disposition": `attachment; filename="curso-${artifactId}-${audience}.html"` } : {}),
    } });
  } catch (error) { return new Response("No se pudo verificar el acceso o preparar el documento.", { status: error instanceof DeliveryAccessError ? error.status : error instanceof z.ZodError ? 400 : 409, headers: { "Cache-Control": "no-store" } }); }
}
