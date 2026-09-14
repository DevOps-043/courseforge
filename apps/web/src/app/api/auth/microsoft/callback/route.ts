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
  parseMicrosoftAccountProfile,
} from "@/domains/production/providers/provider-json-contracts";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const OAUTH_RESPONSE_MAX_BYTES = 64 * 1024;

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  const logger = createOperationalLogger("auth.microsoft.callback", { correlationId: requestId });
  const requestUrl = new URL(request.url);
  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;

  try {
    const { searchParams } = requestUrl;
    const code = searchParams.get("code");
    const error = searchParams.get("error");
    const state = await validateOAuthState({
      expectedProvider: "onedrive",
      state: searchParams.get("state"),
    });

    if (error || !code || !state?.userId || !state?.organizationId || !state?.organizationSlug) {
      return oauthPopupResponse({
        provider: "onedrive",
        status: "error",
        message: "microsoft_oauth_failed",
        requestId,
      });
    }

    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${baseUrl}/api/auth/microsoft/callback`;
    const tokenResponse = await fetchWithDeadline("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID || "",
        client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "openid email profile offline_access User.Read Files.ReadWrite",
      }).toString(),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Microsoft rechazo el intercambio OAuth (HTTP ${tokenResponse.status}).`);
    }

    const tokenData = parseAccessTokenPayload(
      await readJsonResponseWithLimit(tokenResponse, OAUTH_RESPONSE_MAX_BYTES),
      "Microsoft",
      true,
    );
    if (!tokenData.refreshToken) {
      throw new Error("Microsoft no devolvio refresh_token. Revisa el scope offline_access.");
    }

    const profileResponse = await fetchIdempotentWithRetry("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokenData.accessToken}` },
    });

    if (!profileResponse.ok) {
      throw new Error("No se pudo obtener el perfil de Microsoft Graph");
    }

    const { email: accountEmail } = parseMicrosoftAccountProfile(
      await readJsonResponseWithLimit(profileResponse, OAUTH_RESPONSE_MAX_BYTES),
    );

    await upsertCloudStorageCredentials({
      accessToken: tokenData.accessToken,
      accountEmail,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      organizationId: state.organizationId,
      provider: "onedrive",
      refreshToken: tokenData.refreshToken,
      scopes: ["openid", "email", "profile", "offline_access", "User.Read", "Files.ReadWrite"],
      userId: state.userId,
    });

    return oauthPopupResponse({
      provider: "onedrive",
      status: "success",
      redirectPath: `/${state.organizationSlug}/admin/integrations?onedrive_connected=true`,
      requestId,
    });
  } catch (error: unknown) {
    logger.error("microsoft_oauth.callback_failed", error);
    return oauthPopupResponse({
      provider: "onedrive",
      status: "error",
      message: "microsoft_oauth_failed",
      requestId,
    });
  }
}
