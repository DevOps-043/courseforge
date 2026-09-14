import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { decrypt } from "@/lib/server/crypto";
import { validateOAuthState } from "@/lib/server/oauth-state";
import { oauthPopupResponse } from "@/lib/server/oauth-popup-response";
import {
  fetchIdempotentWithRetry,
  fetchWithDeadline,
  readJsonResponseWithLimit,
} from "@/lib/server/outbound-http";
import { upsertCloudStorageCredentials } from "@/domains/production/cloud-storage/credentials.repository";
import {
  parseAccessTokenPayload,
  parseGoogleAccountProfile,
} from "@/domains/production/providers/provider-json-contracts";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const OAUTH_RESPONSE_MAX_BYTES = 64 * 1024;

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("auth.google.callback", { correlationId: requestId });
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
      logger.warn("google_oauth.invalid_callback", { providerError: error || undefined });
      return oauthPopupResponse({
        provider: "google_drive",
        status: "error",
        message: "google_oauth_failed",
        requestId,
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

    const tokenData = parseAccessTokenPayload(
      await readJsonResponseWithLimit(tokenResponse, OAUTH_RESPONSE_MAX_BYTES),
      "Google",
      true,
    );
    const expiresAt = new Date(Date.now() + tokenData.expiresIn * 1000).toISOString();
    const userinfoResponse = await fetchIdempotentWithRetry("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.accessToken}` },
    });

    if (!userinfoResponse.ok) {
      throw new Error("No se pudo obtener el email del usuario de Google");
    }

    const { email: accountEmail } = parseGoogleAccountProfile(
      await readJsonResponseWithLimit(userinfoResponse, OAUTH_RESPONSE_MAX_BYTES),
    );

    const adminClient = getServiceRoleClient();
    let refreshToken = tokenData.refreshToken;
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
      accessToken: tokenData.accessToken,
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
      requestId,
    });
  } catch (error: unknown) {
    logger.error("google_oauth.callback_failed", error);
    return oauthPopupResponse({
      provider: "google_drive",
      status: "error",
      message: "google_oauth_failed",
      requestId,
    });
  }
}
