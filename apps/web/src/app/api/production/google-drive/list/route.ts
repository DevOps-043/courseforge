import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { GoogleDriveService } from "@/domains/production/providers/google-drive.service";

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

    const driveService = new GoogleDriveService();
    const files = await driveService.listFiles(query);

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
