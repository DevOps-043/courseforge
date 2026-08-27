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
  ProductionProviderCredentialsService,
} from "@/domains/production/providers/credentials/provider-credentials.service";
import {
  LiveAvatarApiError,
  LiveAvatarClient,
} from "@/domains/production/providers/liveavatar/liveavatar.client";
import { createClient } from "@/utils/supabase/server";

const connectionSchema = z.object({
  action: z.literal("connect"),
  apiKey: z.string().trim().min(12).max(500),
}).strict();

const embeddingSchema = z.object({
  action: z.literal("create_embedding"),
  avatarId: z.string().trim().min(1).max(255),
  contextId: z.string().trim().min(1).max(255),
  isSandbox: z.boolean().default(true),
}).strict();

const requestSchema = z.discriminatedUnion("action", [connectionSchema, embeddingSchema]);

export async function GET() {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const credentials = new ProductionProviderCredentialsService({ supabase: getServiceRoleClient() });
    const status = await credentials.getCredentialStatus({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    if (!status.connected) {
      return NextResponse.json({ success: true, data: { status, avatars: [], contexts: [], credits: null } });
    }
    const secret = await credentials.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    if (!secret?.secret) throw new Error("La credencial LiveAvatar no está disponible.");
    const client = new LiveAvatarClient(secret.secret);
    const [credits, avatars, publicAvatars, contexts] = await Promise.all([
      client.getCredits(),
      client.listAvatars(),
      client.listPublicAvatars(),
      client.listContexts(),
    ]);
    return NextResponse.json({
      success: true,
      data: { avatars, contexts, credits, publicAvatars, status },
    });
  } catch (error) {
    return handleError(error, "consultar LiveAvatar");
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const admin = getServiceRoleClient();
    const credentials = new ProductionProviderCredentialsService({ supabase: admin });

    if (payload.action === "connect") {
      const client = new LiveAvatarClient(payload.apiKey);
      const credits = await client.getCredits();
      const status = await credentials.upsertValidatedSecret({
        createdBy: context.user.userId,
        metadata: { validation_provider: "liveavatar" },
        organizationId: context.tenant.organizationId,
        provider: "liveavatar",
        secret: payload.apiKey.trim(),
      });
      return NextResponse.json({ success: true, data: { credits, status } });
    }

    const secret = await credentials.getDecryptedSecret({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    if (!secret?.secret) {
      return NextResponse.json({ error: "Conecta LiveAvatar antes de crear un embed." }, { status: 409 });
    }
    const embedding = await new LiveAvatarClient(secret.secret).createEmbedding(payload);
    const { error: settingsError } = await admin.from("heygen_workspace_settings").upsert({
      liveavatar_avatar_id: payload.avatarId,
      liveavatar_context_id: payload.contextId,
      liveavatar_sandbox: payload.isSandbox,
      organization_id: context.tenant.organizationId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "organization_id" });
    if (settingsError) throw settingsError;
    return NextResponse.json({ success: true, data: embedding }, { status: 201 });
  } catch (error) {
    return handleError(error, "configurar LiveAvatar");
  }
}

export async function DELETE() {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const credentials = new ProductionProviderCredentialsService({ supabase: getServiceRoleClient() });
    const status = await credentials.revokeCredential({
      organizationId: context.tenant.organizationId,
      provider: "liveavatar",
    });
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    return handleError(error, "desconectar LiveAvatar");
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: NextResponse.json({ error: "No autorizado." }, { status: 401 }), tenant: null as never, user: null as never };
  if (!(await canReviewContent(user.userId))) {
    return { response: NextResponse.json({ error: "No tienes permisos para administrar LiveAvatar." }, { status: 403 }), tenant: null as never, user };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 }), tenant: null as never, user };
  return { response: null, tenant, user };
}

function handleError(error: unknown, action: string) {
  if (error instanceof z.ZodError) {
    return NextResponse.json({ error: error.issues[0]?.message || "Solicitud LiveAvatar inválida." }, { status: 400 });
  }
  if (error instanceof LiveAvatarApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 502 });
  }
  console.error(`[API /production/liveavatar] No se pudo ${action}:`, { message: getErrorMessage(error) });
  return NextResponse.json({ error: `No se pudo ${action}.` }, { status: 500 });
}
