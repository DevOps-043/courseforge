import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { createOAuthState } from "@/lib/server/oauth-state";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { API_ERROR_CODE } from "@/lib/server/api-contract";
import { apiErrorResponse } from "@/lib/server/api-response";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get("x-request-id"));
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return apiErrorResponse({ code: API_ERROR_CODE.authRequired, message: "No autorizado", requestId, status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return apiErrorResponse({ code: API_ERROR_CODE.tenantForbidden, message: "Empresa no valida o no autorizada", requestId, status: 403 });
    }

    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;

    const redirectResponse = NextResponse.redirect("https://accounts.google.com/o/oauth2/v2/auth");
    const state = createOAuthState({
      organizationId: tenant.organizationId,
      organizationSlug: tenant.organizationSlug,
      provider: "google_drive",
      response: redirectResponse,
      userId: user.userId,
    });

    const options = {
      redirect_uri: redirectUri,
      client_id: process.env.GOOGLE_CLIENT_ID || "",
      access_type: "offline",
      response_type: "code",
      prompt: "consent",
      scope: [
        "openid",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/drive.file",
      ].join(" "),
      state,
    };

    const qs = new URLSearchParams(options).toString();
    redirectResponse.headers.set("Location", `https://accounts.google.com/o/oauth2/v2/auth?${qs}`);
    redirectResponse.headers.set("x-request-id", requestId);
    return redirectResponse;
  } catch (error: unknown) {
    createOperationalLogger("auth.google.login", { correlationId: requestId })
      .error("google_oauth.login_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error iniciando flujo OAuth", requestId, retryable: true, status: 500 });
  }
}
