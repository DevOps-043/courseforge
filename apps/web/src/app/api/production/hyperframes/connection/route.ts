import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  ProductionProviderCredentialError,
  ProductionProviderCredentialsService,
} from "@/domains/production/providers/credentials/provider-credentials.service";
import { HyperframesConnectionService } from "@/domains/production/hyperframes/hyperframes-connection.service";
import {
  configureHeygenHyperframesWebhook,
  disconnectHeygenHyperframesWebhook,
} from "@/domains/production/providers/heygen/heygen-webhook.service";
import { createClient } from "@/utils/supabase/server";

const connectionRequestSchema = z.object({ apiKey: z.string().trim().min(12).max(500) }).strict();

export async function GET() {
  try {
    const context = await resolveAuthorizedContext("consultar");
    if (context.response) return context.response;
    const service = new HyperframesConnectionService(getServiceRoleClient());
    const status = await service.getStatus(context.tenant.organizationId);
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    return unexpected(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = connectionRequestSchema.parse(await request.json().catch(() => ({})));
    const context = await resolveAuthorizedContext("configurar");
    if (context.response) return context.response;
    const admin = getServiceRoleClient();
    const service = new HyperframesConnectionService(admin);
    const credentials = new ProductionProviderCredentialsService({ supabase: admin });
    const previous = await credentials.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "hyperframes_cloud",
    });
    const status = await service.saveApiKey({
      apiKey: payload.apiKey,
      createdBy: context.user.userId,
      organizationId: context.tenant.organizationId,
    });
    await configureHeygenHyperframesWebhook({
      apiKey: payload.apiKey,
      organizationId: context.tenant.organizationId,
      previousApiKey: previous?.secret,
      supabase: admin,
    });
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Ingresa una API key de HyperFrames Cloud válida." }, { status: 400 });
    }
    if (error instanceof ProductionProviderCredentialError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return unexpected(error);
  }
}

export async function DELETE() {
  try {
    const context = await resolveAuthorizedContext("desconectar");
    if (context.response) return context.response;
    const admin = getServiceRoleClient();
    const service = new ProductionProviderCredentialsService({ supabase: admin });
    const credential = await service.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "hyperframes_cloud",
    });
    const avatarStatus = await service.getCredentialStatus({
      organizationId: context.tenant.organizationId,
      provider: "heygen_avatar",
    });
    if (credential?.secret && !avatarStatus.connected) {
      await disconnectHeygenHyperframesWebhook({
        apiKey: credential.secret,
        organizationId: context.tenant.organizationId,
        supabase: admin,
      });
    } else if (!avatarStatus.connected) {
      const { error } = await admin.rpc("clear_heygen_webhook", {
        p_organization_id: context.tenant.organizationId,
      });
      if (error) throw error;
    }
    const status = await service.revokeCredential({
      organizationId: context.tenant.organizationId,
      provider: "hyperframes_cloud",
    });
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    return unexpected(error);
  }
}

async function resolveAuthorizedContext(action: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: NextResponse.json({ error: "No autorizado." }, { status: 401 }), tenant: null as never, user: null as never };
  if (!(await canReviewContent(user.userId))) {
    return { response: NextResponse.json({ error: `No tienes permisos para ${action} HyperFrames Cloud.` }, { status: 403 }), tenant: null as never, user };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 }), tenant: null as never, user };
  return { response: null, tenant, user };
}

function unexpected(error: unknown) {
  console.error("[API /production/hyperframes/connection] Unexpected error:", { message: getErrorMessage(error) });
  return NextResponse.json({ error: "No se pudo gestionar la conexión de HyperFrames Cloud." }, { status: 500 });
}
