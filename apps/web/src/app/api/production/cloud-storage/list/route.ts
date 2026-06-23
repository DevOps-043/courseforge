import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { getCloudStorageService } from "@/domains/production/cloud-storage/cloud-storage.service";
import { isCloudStorageProvider } from "@/domains/production/cloud-storage/types";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";
    const provider = searchParams.get("provider");

    if (!isCloudStorageProvider(provider)) {
      return NextResponse.json({ error: "Proveedor cloud invalido" }, { status: 400 });
    }

    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json({ error: "Empresa no valida o no autorizada." }, { status: 403 });
    }

    const files = await getCloudStorageService(provider).listFiles(
      authenticatedUser.userId,
      tenant.organizationId,
      query,
    );

    return NextResponse.json({
      success: true,
      files,
    });
  } catch (error: unknown) {
    console.error("[API /cloud-storage/list] Unexpected error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al buscar en el proveedor cloud" },
      { status: 500 },
    );
  }
}
