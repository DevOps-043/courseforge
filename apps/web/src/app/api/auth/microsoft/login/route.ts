import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { createOAuthState } from "@/lib/server/oauth-state";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json({ error: "Empresa no valida o no autorizada" }, { status: 403 });
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
    return response;
  } catch (error) {
    console.error("[Microsoft OAuth Login Error]:", error);
    return NextResponse.json({ error: "Error iniciando flujo OAuth de Microsoft" }, { status: 500 });
  }
}
