import { NextResponse } from "next/server";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { encrypt } from "@/lib/server/crypto";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const stateUserId = searchParams.get("state"); // UUID del usuario profiles
    const error = searchParams.get("error");

    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

    if (error || !code || !stateUserId) {
      console.error("[Google OAuth Callback Error] Params missing or error:", { error, code, stateUserId });
      return NextResponse.redirect(new URL("/admin/profile?error=" + (error || "oauth_failed"), baseUrl));
    }

    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;

    // Intercambiar código por tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errData = await tokenResponse.json();
      throw new Error(errData.error_description || "Error al obtener tokens de Google");
    }

    const tokenData = await tokenResponse.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Obtener información del usuario de Google
    const userinfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    
    if (!userinfoResponse.ok) {
      throw new Error("No se pudo obtener el email del usuario de Google");
    }
    
    const googleUser = await userinfoResponse.json();
    const googleEmail = googleUser.email;

    if (!googleEmail) {
      throw new Error("No se devolvió ningún email desde Google");
    }

    // Cifrar los tokens antes de almacenarlos
    const encryptedAccess = encrypt(tokenData.access_token);
    const encryptedRefresh = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : null;

    const adminClient = getServiceRoleClient();

    // Si ya existe un refresh_token y no nos devolvió uno nuevo (flujos subsiguientes sin desvincular),
    // conservamos el refresh_token anterior.
    if (!encryptedRefresh) {
      const { data: existing } = await adminClient
        .from("user_google_credentials")
        .select("refresh_token")
        .eq("user_id", stateUserId)
        .maybeSingle();

      if (!existing?.refresh_token) {
        throw new Error("No se recibió refresh_token de Google y tampoco existe uno previo en la base de datos.");
      }
      
      const { error: dbError } = await adminClient
        .from("user_google_credentials")
        .upsert({
          user_id: stateUserId,
          google_email: googleEmail,
          access_token: encryptedAccess,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (dbError) throw dbError;
    } else {
      const { error: dbError } = await adminClient
        .from("user_google_credentials")
        .upsert({
          user_id: stateUserId,
          google_email: googleEmail,
          access_token: encryptedAccess,
          refresh_token: encryptedRefresh,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" });

      if (dbError) throw dbError;
    }

    return NextResponse.redirect(new URL("/admin/profile?google_connected=true", baseUrl));
  } catch (err: any) {
    console.error("[Google OAuth Callback Error]:", err);
    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    return NextResponse.redirect(new URL("/admin/profile?error=oauth_failed", baseUrl));
  }
}
