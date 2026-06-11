"use server";

import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { decrypt } from "@/lib/server/crypto";

export async function checkGoogleConnectionAction() {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return { connected: false, error: "No autorizado" };

    const adminClient = getServiceRoleClient();
    const { data, error } = await adminClient
      .from("user_google_credentials")
      .select("google_email")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (error) {
      console.error("[Google Connection Check Action Error]:", error);
      return { connected: false };
    }

    return {
      connected: Boolean(data),
      email: data?.google_email || null,
    };
  } catch (error) {
    console.error("[Google Connection Check Action Error]:", error);
    return { connected: false };
  }
}

export async function disconnectGoogleAction() {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return { success: false, error: "No autorizado" };

    const adminClient = getServiceRoleClient();
    const { data: creds } = await adminClient
      .from("user_google_credentials")
      .select("refresh_token, access_token")
      .eq("user_id", user.userId)
      .maybeSingle();

    if (creds) {
      try {
        const tokenToRevoke = decrypt(creds.refresh_token || creds.access_token);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" }
        });
      } catch (revokeErr) {
        console.warn("[Google Disconnect Action] Falló la revocación de tokens en Google:", revokeErr);
      }

      const { error: deleteError } = await adminClient
        .from("user_google_credentials")
        .delete()
        .eq("user_id", user.userId);

      if (deleteError) {
        throw new Error(deleteError.message);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error("[Google Disconnect Action Error]:", error);
    return { success: false, error: error.message || "Error al desvincular Google Drive" };
  }
}
