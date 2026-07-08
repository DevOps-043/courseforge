import { NextResponse } from "next/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { resolveBundleStorageLocation } from "@/domains/production/templates/template-version.service";
import { sanitizeErrorMessage } from "@/domains/production/bundle-agent/redaction.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext {
  params: Promise<{
    versionId: string;
  }>;
}

function fileNameFromVersion(version: { original_file_name?: string | null; storage_path: string }) {
  const name = version.original_file_name || version.storage_path.split("/").filter(Boolean).at(-1) || "remotion-template-bundle.zip";
  return name.endsWith(".zip") ? name : `${name}.zip`;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { versionId } = await context.params;
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      throw new Error("No autorizado.");
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant?.organizationId) {
      throw new Error("No se encontro organizacion activa.");
    }

    const admin = getServiceRoleClient();
    const { data: version, error } = await admin
      .from("remotion_template_versions")
      .select("id, organization_id, storage_path, original_file_name")
      .eq("id", versionId)
      .eq("organization_id", tenant.organizationId)
      .maybeSingle();

    if (error) throw error;
    if (!version?.storage_path) {
      throw new Error("Version de plantilla no encontrada para esta organizacion.");
    }

    const location = resolveBundleStorageLocation(version.storage_path);
    const expectedPrefix = `organizations/${tenant.organizationId}/`;
    if (location.bucket !== "template-bundles" || !location.path.startsWith(expectedPrefix)) {
      throw new Error("La ruta del bundle no pertenece a la organizacion activa.");
    }

    const { data, error: downloadError } = await admin.storage
      .from(location.bucket)
      .download(location.path);

    if (downloadError || !data) {
      throw downloadError || new Error("No se pudo descargar el bundle desde storage.");
    }

    return new NextResponse(Buffer.from(await data.arrayBuffer()), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileNameFromVersion(version)}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    return NextResponse.json({ success: false, error: message }, { status: message.includes("No autorizado") ? 401 : 404 });
  }
}
