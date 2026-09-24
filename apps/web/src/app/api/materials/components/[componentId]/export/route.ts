import { NextResponse } from "next/server";
import JSZip from "jszip";
import { z } from "zod";
import { getAuthenticatedUser, getAuthorizedMaterialComponentAdmin } from "@/lib/server/artifact-action-auth";
import { createClient } from "@/utils/supabase/server";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { recordAssetAccessAudit } from "@/domains/materials/downloads/asset-access-audit.service";

interface RouteContext { params: Promise<{ componentId: string }>; }

/**
 * Exports editable material data without exposing storage paths, signed URLs,
 * or other internal-only delivery metadata.
 */
export async function GET(request: Request, context: RouteContext) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("materials.component.export", { correlationId: requestId });
  try {
    const { componentId } = await context.params;
    const parsedComponentId = z.string().uuid().parse(componentId);
    const session = await createClient();
    const user = await getAuthenticatedUser(session);
    if (!user) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado.", requestId, status: 401 });
    }
    const authorized = await getAuthorizedMaterialComponentAdmin(parsedComponentId);
    if (!authorized) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Material no encontrado para esta empresa.", requestId, status: 404 });
    }
    const component = authorized.component;
    const componentType = component.type || "MATERIAL";
    const format = new URL(request.url).searchParams.get("format") || "json";
    if (format !== "json" && format !== "zip") {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Formato de exportación inválido.", requestId, status: 400 });
    }
    const exportPayload = {
      schemaVersion: "courseforge-material-export/v1",
      exportedAt: new Date().toISOString(),
      component: {
        content: component.content || {},
        id: component.id,
        sourceReferences: [],
        type: componentType,
      },
    };
    const admin = getServiceRoleClient();
    const organizationId = await resolveOrganizationId(authorized.artifactId, admin);
    if (!organizationId) {
      return apiErrorResponse({ code: API_ERROR_CODE.resourceNotFound, message: "Material no encontrado para esta empresa.", requestId, status: 404 });
    }
    if (format === "zip") {
      const manifest = await buildAssetManifest(component.id, admin);
      const archive = new JSZip();
      archive.file("material.json", JSON.stringify(exportPayload, null, 2));
      archive.file("asset-manifest.json", JSON.stringify(manifest, null, 2));
      archive.file("README.txt", "Este paquete contiene contenido editable y un manifiesto de binarios. Descarga cada binario desde Courseforge con su endpoint autorizado; las URLs firmadas no se incluyen por seguridad.\n");
      const body = await archive.generateAsync({ compression: "DEFLATE", type: "uint8array" });
      await auditExport({ admin, actorId: user.userId, componentId: component.id, eventType: "EXPORT_ZIP", metadata: { assetCount: manifest.assets.length }, organizationId, requestId, logger });
      const fileName = `courseforge-material-${componentType.toLowerCase()}-${component.id}.zip`;
      return new NextResponse(new Uint8Array(body).buffer, { headers: downloadHeaders("application/zip", fileName, requestId) });
    }
    const body = JSON.stringify(exportPayload, null, 2);
    await auditExport({ admin, actorId: user.userId, componentId: component.id, eventType: "EXPORT_JSON", organizationId, requestId, logger });
    const fileName = `courseforge-material-${componentType.toLowerCase()}-${component.id}.json`;
    return new NextResponse(body, {
      headers: {
        ...downloadHeaders("application/json; charset=utf-8", fileName, requestId),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiErrorResponse({ code: API_ERROR_CODE.invalidRequest, message: "Identificador de componente inválido.", requestId, status: 400 });
    }
    logger.error("materials.component.export.failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "No se pudo exportar el material.", requestId, retryable: true, status: 500 });
  }
}

async function buildAssetManifest(componentId: string, admin: ReturnType<typeof getServiceRoleClient>) {
  const { data, error } = await admin
    .from("production_assets")
    .select("id, asset_type, checksum, file_size_bytes, mime_type, provider, metadata, created_at")
    .eq("material_component_id", componentId)
    .not("storage_bucket", "is", null)
    .not("storage_path", "is", null)
    .neq("qa_status", "ARCHIVED")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return {
    schemaVersion: "courseforge-asset-manifest/v1",
    assets: (data || []).map((asset) => ({
      assetId: asset.id,
      assetType: asset.asset_type,
      checksumSha256: asset.checksum,
      createdAt: asset.created_at,
      downloadEndpoint: `/api/production/assets/${asset.id}/download`,
      fileName: isRecord(asset.metadata) && typeof asset.metadata.file_name === "string" ? asset.metadata.file_name : null,
      fileSizeBytes: asset.file_size_bytes,
      mimeType: asset.mime_type,
      provider: asset.provider,
    })),
  };
}

async function resolveOrganizationId(artifactId: string, admin: ReturnType<typeof getServiceRoleClient>) {
  const { data, error } = await admin.from("artifacts").select("organization_id").eq("id", artifactId).maybeSingle();
  if (error) throw error;
  return data?.organization_id || null;
}

async function auditExport(params: {
  admin: ReturnType<typeof getServiceRoleClient>;
  actorId: string;
  componentId: string;
  eventType: "EXPORT_JSON" | "EXPORT_ZIP";
  logger: ReturnType<typeof createOperationalLogger>;
  metadata?: Record<string, unknown>;
  organizationId: string;
  requestId: string;
}) {
  try {
    await recordAssetAccessAudit({ actorId: params.actorId, eventType: params.eventType, metadata: params.metadata, organizationId: params.organizationId, requestId: params.requestId, resourceId: params.componentId, resourceType: "MATERIAL_COMPONENT", supabase: params.admin });
  } catch (auditError) {
    params.logger.warn("materials.component.export.audit_failed", { componentId: params.componentId, error: auditError });
  }
}

function downloadHeaders(contentType: string, fileName: string, requestId: string) {
  return { "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="${fileName}"`, "Content-Type": contentType, "x-request-id": requestId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
