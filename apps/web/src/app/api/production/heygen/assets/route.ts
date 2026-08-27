import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HeygenApiError } from "@/domains/production/providers/heygen/heygen.client";
import { getHeygenClientForOrganization, HeygenCredentialResolverError } from "@/domains/production/providers/heygen/heygen-credential-resolver.service";
import { createClient } from "@/utils/supabase/server";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("prepare"),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    contentType: z.string().trim().min(3).max(150),
    fileName: z.string().trim().min(1).max(255),
    sizeBytes: z.number().int().positive().max(5 * 1024 * 1024 * 1024),
  }).strict(),
  z.object({
    action: z.literal("complete"),
    assetId: z.string().trim().min(1).max(255),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  }).strict(),
]);

export async function GET(request: Request) {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const client = await resolveClient(context.tenant.organizationId);
    const url = new URL(request.url);
    const query = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50))) });
    const token = url.searchParams.get("token");
    if (token) query.set("token", token);
    const data = await client.platformRequest({ path: `/v3/assets?${query}` });
    return NextResponse.json({ success: true, data });
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  try {
    const context = await authorize();
    if (context.response) return context.response;
    const payload = requestSchema.parse(await request.json().catch(() => ({})));
    const client = await resolveClient(context.tenant.organizationId);
    const data = payload.action === "prepare"
      ? await client.platformRequest({
          body: {
            checksum_sha256: payload.checksumSha256,
            content_type: payload.contentType,
            filename: payload.fileName,
            size_bytes: payload.sizeBytes,
          },
          idempotencyKey: crypto.randomUUID(),
          method: "POST",
          path: "/v3/assets/direct-uploads",
        })
      : await client.platformRequest({
          body: { checksum_sha256: payload.checksumSha256 },
          method: "POST",
          path: `/v3/assets/${encodeURIComponent(payload.assetId)}/complete`,
        });
    return NextResponse.json({ success: true, data });
  } catch (error) { return handleError(error); }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { response: NextResponse.json({ error: "No autorizado." }, { status: 401 }), tenant: null as never };
  if (!(await canReviewContent(user.userId))) return { response: NextResponse.json({ error: "No tienes permisos para administrar assets HeyGen." }, { status: 403 }), tenant: null as never };
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return { response: NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 }), tenant: null as never };
  return { response: null, tenant };
}

async function resolveClient(organizationId: string) {
  return (await getHeygenClientForOrganization({
    allowGlobalFallback: false,
    organizationId,
    supabase: getServiceRoleClient(),
  })).client;
}

function handleError(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || "Solicitud de asset inválida." }, { status: 400 });
  if (error instanceof HeygenCredentialResolverError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  if (error instanceof HeygenApiError) return NextResponse.json({ error: error.message }, { status: error.status === 429 ? 429 : 502 });
  console.error("[API /production/heygen/assets] Unexpected error:", { message: getErrorMessage(error) });
  return NextResponse.json({ error: "No se pudo gestionar el asset HeyGen." }, { status: 500 });
}
