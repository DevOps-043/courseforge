import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { decrypt } from "@/lib/server/crypto";
import { validateOAuthState } from "@/lib/server/oauth-state";
import { oauthPopupResponse } from "@/lib/server/oauth-popup-response";
import { fetchWithDeadline } from "@/lib/server/outbound-http";
import { upsertCloudStorageCredentials } from "@/domains/production/cloud-storage/credentials.repository";

interface GoogleOAuthTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface GoogleUserInfoResponse {
  email?: string;
}

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

    if (error || !code || !state?.userId || !state?.organizationId || !state?.organizationSlug) {
      console.error("[Google OAuth Callback Error] Params missing or state invalid:", { error });
      return oauthPopupResponse({
        provider: "google_drive",
        status: "error",
        message: "google_oauth_failed",
      });
    }

    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;
    const tokenResponse = await fetchWithDeadline("https://oauth2.googleapis.com/token", {
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
      throw new Error(`Google rechazo el intercambio OAuth (HTTP ${tokenResponse.status}).`);
    }

    const tokenData = (await tokenResponse.json()) as GoogleOAuthTokenResponse;
    if (!tokenData.access_token || !tokenData.expires_in) {
      throw new Error("Google devolvio una respuesta OAuth incompleta.");
    }
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const userinfoResponse = await fetchWithDeadline("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userinfoResponse.ok) {
      throw new Error("No se pudo obtener el email del usuario de Google");
    }

    const googleUser = (await userinfoResponse.json()) as GoogleUserInfoResponse;
    const accountEmail = googleUser.email;
    if (!accountEmail) {
      throw new Error("No se devolvio ningun email desde Google");
    }

    const adminClient = getServiceRoleClient();
    let refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      const { data: existing } = await adminClient
        .from("user_cloud_storage_credentials")
        .select("refresh_token")
        .eq("user_id", state.userId)
        .eq("organization_id", state.organizationId)
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

    await upsertCloudStorageCredentials({
      accessToken: tokenData.access_token,
      accountEmail,
      expiresAt,
      organizationId: state.organizationId,
      provider: "google_drive",
      refreshToken,
      scopes: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"],
      userId: state.userId,
    });

    return oauthPopupResponse({
      provider: "google_drive",
      status: "success",
      redirectPath: `/${state.organizationSlug}/admin/integrations?google_connected=true`,
    });
  } catch (error: unknown) {
    console.error(
      "[Google OAuth Callback Error]:",
      error instanceof Error ? error.message : "unknown_error",
    );
    return oauthPopupResponse({
      provider: "google_drive",
      status: "error",
      message: "google_oauth_failed",
    });
  }
}
