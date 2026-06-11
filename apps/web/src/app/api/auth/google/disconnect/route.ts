import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { decrypt } from "@/lib/server/crypto";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const adminClient = getServiceRoleClient();
    const { data: creds } = await adminClient
      .from("user_google_credentials")
      .select("refresh_token, access_token")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (creds) {
      // Intentar revocar el token en Google
      try {
        const tokenToRevoke = decrypt(creds.refresh_token || creds.access_token);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
      } catch (revokeErr) {
        console.warn("[Google Disconnect] Falló la revocación de tokens en Google:", revokeErr);
      }

      // Eliminar el registro en base de datos local
      const { error: deleteError } = await adminClient
        .from("user_google_credentials")
        .delete()
        .eq("user_id", user.userId);

      if (deleteError) throw deleteError;
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[Google Disconnect Error]:", error);
    return NextResponse.json({ error: "Error al desvincular Google Drive" }, { status: 500 });
  }
}
