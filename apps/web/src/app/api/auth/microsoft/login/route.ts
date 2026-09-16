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
    const redirectUri = process.env.MICROSOFT_REDIRECT_URI || `${baseUrl}/api/auth/microsoft/callback`;
    const response = NextResponse.redirect("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    const state = createOAuthState({
      organizationId: tenant.organizationId,
      organizationSlug: tenant.organizationSlug,
      provider: "onedrive",
      response,
      userId: user.userId,
    });

    const qs = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID || "",
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: "openid email profile offline_access User.Read Files.ReadWrite",
      state,
      prompt: "select_account",
    }).toString();

    response.headers.set("Location", `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${qs}`);
    response.headers.set("x-request-id", requestId);
    return response;
  } catch (error: unknown) {
    createOperationalLogger("auth.microsoft.login", { correlationId: requestId })
      .error("microsoft_oauth.login_failed", error);
    return apiErrorResponse({ code: API_ERROR_CODE.internalError, message: "Error iniciando flujo OAuth de Microsoft", requestId, retryable: true, status: 500 });
  }
}
