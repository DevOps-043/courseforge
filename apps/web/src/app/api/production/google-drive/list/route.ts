import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { GoogleDriveService } from "@/domains/production/providers/google-drive.service";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q") || "";

    // Authenticate User
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json({ error: "Empresa no valida o no autorizada." }, { status: 403 });
    }

    const driveService = new GoogleDriveService();
    const accessToken = await driveService.refreshUserAccessToken(authenticatedUser.userId, tenant.organizationId);
    const files = await driveService.listFiles(query, accessToken);

    return NextResponse.json({
      success: true,
      files,
    });
  } catch (error: unknown) {
    console.error("[API /google-drive/list] Unexpected error:", error);
    return NextResponse.json(
      { error: "Error interno del servidor al buscar en Google Drive" },
      { status: 500 }
    );
  }
}
