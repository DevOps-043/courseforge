import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { decrypt, encrypt } from "@/lib/server/crypto";
import { validateOAuthState } from "@/lib/server/oauth-state";
import { oauthPopupResponse } from "@/lib/server/oauth-popup-response";
import { upsertCloudStorageCredentials } from "@/domains/production/cloud-storage/credentials.repository";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  try {
    const { searchParams } = requestUrl;
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const state = await validateOAuthState({
      expectedProvider: "google_drive",
      state: searchParams.get("state"),
    });

    if (error || !code || !state?.userId) {
      console.error("[Google OAuth Callback Error] Params missing or state invalid:", { error });
      return oauthPopupResponse({
        provider: "google_drive",
        status: "error",
        message: error || "oauth_failed",
      });
    }

    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;
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
    const userinfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userinfoResponse.ok) {
      throw new Error("No se pudo obtener el email del usuario de Google");
    }

    const googleUser = await userinfoResponse.json();
    const accountEmail = googleUser.email;
    if (!accountEmail) {
      throw new Error("No se devolvio ningun email desde Google");
    }

    const adminClient = getServiceRoleClient();
    let refreshToken = tokenData.refresh_token as string | undefined;
    if (!refreshToken) {
      const { data: existing } = await adminClient
        .from("user_cloud_storage_credentials")
        .select("refresh_token")
        .eq("user_id", state.userId)
        .eq("provider", "google_drive")
        .maybeSingle();

      if (!existing?.refresh_token) {
        throw new Error("No se recibio refresh_token de Google y tampoco existe uno previo.");
      }
      refreshToken = decrypt(existing.refresh_token);
    }

    if (!refreshToken) {
      throw new Error("No se pudo resolver refresh_token de Google.");
    }

    const encryptedRefreshToken = encrypt(refreshToken);
    await upsertCloudStorageCredentials({
      accessToken: tokenData.access_token,
      accountEmail,
      expiresAt,
      provider: "google_drive",
      refreshToken,
      scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"],
      userId: state.userId,
    });

    const { error: legacyGoogleError } = await adminClient
      .from("user_google_credentials")
      .upsert(
        {
          user_id: state.userId,
          google_email: accountEmail,
          access_token: encrypt(tokenData.access_token),
          refresh_token: encryptedRefreshToken,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (legacyGoogleError) {
      console.warn("[Google OAuth Callback] Legacy user_google_credentials sync skipped:", legacyGoogleError.message);
    }

    return oauthPopupResponse({
      provider: "google_drive",
      status: "success",
      redirectPath: "/admin/profile?google_connected=true",
    });
  } catch (err: any) {
    console.error("[Google OAuth Callback Error]:", err);
    return oauthPopupResponse({
      provider: "google_drive",
      status: "error",
      message: err?.message || "oauth_failed",
    });
  }
}
