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
      expectedProvider: "onedrive",
      state: searchParams.get("state"),
    });

    if (error || !code || !state?.userId) {
      return oauthPopupResponse({
        provider: "onedrive",
        status: "error",
        message: error || "microsoft_oauth_failed",
      });
    }

    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${baseUrl}/api/auth/microsoft/callback`;
    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
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
      const details = await tokenResponse.text();
      throw new Error(`Error al obtener tokens de Microsoft: ${details}`);
    }

    const tokenData = await tokenResponse.json();
    if (!tokenData.refresh_token) {
      throw new Error("Microsoft no devolvio refresh_token. Revisa el scope offline_access.");
    }

    const profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileResponse.ok) {
      throw new Error("No se pudo obtener el perfil de Microsoft Graph");
    }

    const profile = await profileResponse.json();
    const accountEmail = profile.mail || profile.userPrincipalName;
    if (!accountEmail) {
      throw new Error("Microsoft no devolvio email de cuenta");
    }

    await upsertCloudStorageCredentials({
      accessToken: tokenData.access_token,
      accountEmail,
      expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      provider: "onedrive",
      refreshToken: tokenData.refresh_token,
      scopes: ["openid", "email", "profile", "offline_access", "User.Read", "Files.ReadWrite"],
      userId: state.userId,
    });

    return oauthPopupResponse({
      provider: "onedrive",
      status: "success",
      redirectPath: "/admin/profile?onedrive_connected=true",
    });
  } catch (error: any) {
    console.error("[Microsoft OAuth Callback Error]:", error);
    return oauthPopupResponse({
      provider: "onedrive",
      status: "error",
      message: error?.message || "microsoft_oauth_failed",
    });
  }
}
