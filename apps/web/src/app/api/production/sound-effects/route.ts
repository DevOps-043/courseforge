import { NextResponse } from "next/server";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  linkReadySoundEffectToDraft,
  linkSoundEffectToDraftSchema,
  listReadySoundEffects,
  soundEffectLibraryQuerySchema,
  uploadSoundEffectSchema,
  uploadVerifiedWavSoundEffect,
} from "@/domains/production/sound-effects/sound-effect-library.service";
import { createClient } from "@/utils/supabase/server";

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return { error: NextResponse.json({ error: "No tienes permisos para usar efectos de sonido." }, { status: 403 }) };
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}

export async function GET(request: Request) {
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  try {
    const url = new URL(request.url);
    const filters = soundEffectLibraryQuerySchema.parse({
      category: url.searchParams.get("category") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      query: url.searchParams.get("query") || undefined,
    });
    const data = await listReadySoundEffects({ filters, organizationId: authorization.organizationId, supabase: authorization.admin });
    return NextResponse.json({ data, success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
    console.error("[API /production/sound-effects] List failed", error);
    return NextResponse.json({ error: "No se pudo consultar la biblioteca de efectos." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const authorization = await authorize();
  if ("error" in authorization) return authorization.error;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "Debes adjuntar un archivo WAV." }, { status: 400 });
      const input = uploadSoundEffectSchema.parse({
        category: form.get("category"),
        description: form.get("description") || "",
        licenseReference: form.get("licenseReference") || undefined,
        licenseType: form.get("licenseType") || undefined,
        name: form.get("name"),
        tags: String(form.get("tags") || "").split(",").filter(Boolean),
      });
      const data = await uploadVerifiedWavSoundEffect({
        bytes: new Uint8Array(await file.arrayBuffer()), input,
        organizationId: authorization.organizationId, supabase: authorization.admin,
        userId: authorization.userId,
      });
      return NextResponse.json({ data, success: true }, { status: 201 });
    }
    const input = linkSoundEffectToDraftSchema.parse(await request.json());
    const data = await linkReadySoundEffectToDraft({ ...input, organizationId: authorization.organizationId, supabase: authorization.admin });
    return NextResponse.json({ data, success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    if (error instanceof Error && "status" in error) return NextResponse.json({ error: error.message }, { status: Number(error.status) || 400 });
    console.error("[API /production/sound-effects] Link failed", error);
    return NextResponse.json({ error: "No se pudo vincular el efecto de sonido." }, { status: 500 });
  }
}
