import { NextResponse } from "next/server";
import { resolveBundleStorageLocation } from "@/domains/production/templates/template-version.service";
import { resolveBundleAgentAuthContext } from "@/domains/production/bundle-agent/route-context";
import { bundleAgentConversationIdSchema, bundleAgentRouteErrorResponse } from "@/domains/production/bundle-agent/route-contract";
import { resolveCorrelationId } from "@/lib/server/operational-logger";

interface RouteContext {
  params: Promise<{
    conversationId: string;
    runId: string;
  }>;
}

function fileNameFromPath(path: string) {
  const name = path.split("/").filter(Boolean).at(-1) || "soflia-video-bundle.zip";
  return name.endsWith(".zip") ? name : `${name}.zip`;
}

export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const params = await context.params;
    const conversationId = bundleAgentConversationIdSchema.parse(params.conversationId);
    const runId = bundleAgentConversationIdSchema.parse(params.runId);
    const authContext = await resolveBundleAgentAuthContext();
    const { data: run, error } = await authContext.admin
      .from("soflia_bundle_generation_runs")
      .select("id, conversation_id, organization_id, bundle_storage_path")
      .eq("id", runId)
      .eq("conversation_id", conversationId)
      .eq("organization_id", authContext.organizationId)
      .maybeSingle();

    if (error) throw error;
    if (!run?.bundle_storage_path) {
      throw new Error("Bundle no encontrado para esta generacion.");
    }

    const location = resolveBundleStorageLocation(run.bundle_storage_path);
    const expectedPrefix = `organizations/${authContext.organizationId}/`;
    if (location.bucket !== "template-bundles" || !location.path.startsWith(expectedPrefix)) {
      throw new Error("La ruta del bundle no pertenece a la organizacion activa.");
    }

    const { data, error: downloadError } = await authContext.admin.storage
      .from(location.bucket)
      .download(location.path);

    if (downloadError || !data) {
      throw downloadError || new Error("No se pudo descargar el bundle desde storage.");
    }

    return new NextResponse(data, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileNameFromPath(location.path)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return bundleAgentRouteErrorResponse({ component: "admin.bundle-agent.run-download", error, requestId });
  }
}
