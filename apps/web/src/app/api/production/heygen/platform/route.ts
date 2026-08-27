import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { getHeygenClientForOrganization, HeygenCredentialResolverError } from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { HeygenPlatformService, HeygenPlatformServiceError } from "@/domains/production/providers/heygen/heygen-platform.service";
import { heygenAudioSearchSchema, heygenPlatformActionSchema, heygenWorkspaceSettingsSchema } from "@/domains/production/providers/heygen/heygen-platform.validators";

export async function GET(request: Request) {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const service = await buildService(context.tenant.organizationId);
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource") || "dashboard";
    if (resource === "operation") {
      const operationId = z.string().uuid().parse(url.searchParams.get("operationId"));
      const data = await service.refreshOperation({ operationId, organizationId: context.tenant.organizationId });
      return NextResponse.json({ success: true, data });
    }
    if (resource === "audio-search") {
      const query = heygenAudioSearchSchema.parse({
        limit: Number(url.searchParams.get("limit") || 20),
        query: url.searchParams.get("query"),
        type: url.searchParams.get("type") || "music",
      });
      const data = await service.searchAudio(query);
      return NextResponse.json({ success: true, data });
    }
    const data = await service.getDashboard(context.tenant.organizationId);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleError(error, "consultar la plataforma HeyGen");
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const action = heygenPlatformActionSchema.parse(await request.json().catch(() => ({})));
    const service = await buildService(context.tenant.organizationId);
    const data = await service.submit({
      action,
      createdBy: context.user.userId,
      organizationId: context.tenant.organizationId,
    });
    return NextResponse.json({ success: true, data }, { status: 202 });
  } catch (error) {
    return handleError(error, "iniciar la operación HeyGen");
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const settings = heygenWorkspaceSettingsSchema.parse(await request.json().catch(() => ({})));
    const service = await buildService(context.tenant.organizationId);
    const data = await service.updateSettings(context.tenant.organizationId, settings);
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return handleError(error, "guardar la configuración HeyGen");
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: NextResponse.json({ error: "No autorizado." }, { status: 401 }), tenant: null as never, user: null as never };
  if (!(await canReviewContent(user.userId))) {
    return { response: NextResponse.json({ error: "No tienes permisos para administrar HeyGen." }, { status: 403 }), tenant: null as never, user };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 }), tenant: null as never, user };
  return { response: null, tenant, user };
}

async function buildService(organizationId: string) {
  const admin = getServiceRoleClient();
  const auth = await getHeygenClientForOrganization({
    allowGlobalFallback: false,
    organizationId,
    supabase: admin,
  });
  return new HeygenPlatformService(admin, auth.client);
}

function handleError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "Solicitud HeyGen inválida." }, { status: 400 });
  }
  if (error instanceof HeygenPlatformServiceError || error instanceof HeygenCredentialResolverError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof HeygenApiError) {
    return NextResponse.json({ error: error.message, providerCode: error.providerCode || null }, { status: error.status === 429 ? 429 : 502 });
  }
  console.error(`[API /production/heygen/platform] No se pudo ${action}:`, { message: getErrorMessage(error) });
  return NextResponse.json({ error: `No se pudo ${action}.` }, { status: 500 });
}
