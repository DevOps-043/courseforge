import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";

const googleFontSchema = z.object({
  family: z.string().trim().regex(/^[a-zA-Z0-9 ._-]+$/).min(1).max(120),
  source: z.literal("google"),
  cssUrl: z.string().url().max(2000).refine((url) => url.startsWith("https://fonts.googleapis.com/"), "URL de Google Fonts inválida"),
});

const FONT_CONTENT_TYPES = new Set(["font/ttf", "font/otf", "font/woff", "font/woff2", "application/font-woff", "application/x-font-ttf", "application/octet-stream"]);
const FONT_EXTENSION = /\.(woff2?|ttf|otf)$/i;

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  const tenant = await resolveActiveTenantContext();
  if (!user || !tenant?.organizationId) return null;
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}

export async function GET() {
  const context = await authorize();
  if (!context) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data, error } = await context.admin
    .from("organization_slide_fonts")
    .select("id, family, source, css_url, storage_path, created_at")
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "No se pudieron cargar las fuentes." }, { status: 500 });
  const fonts = (data || []).map((font) => ({
    ...font,
    cssUrl: font.css_url || (font.storage_path ? context.admin.storage.from("production-assets").getPublicUrl(font.storage_path).data.publicUrl : undefined),
  }));
  return NextResponse.json({ success: true, fonts });
}

export async function POST(request: Request) {
  const context = await authorize();
  if (!context) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const parsed = googleFontSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ error: "Datos de fuente Google inválidos." }, { status: 400 });
    const { data, error } = await context.admin.from("organization_slide_fonts").insert({
      organization_id: context.organizationId, created_by: context.userId, family: parsed.data.family, source: "google", css_url: parsed.data.cssUrl,
    }).select("id, family, source, css_url, storage_path, created_at").single();
    if (error) return NextResponse.json({ error: "No se pudo guardar la fuente." }, { status: 500 });
    return NextResponse.json({ success: true, font: { ...data, cssUrl: data.css_url } }, { status: 201 });
  }

  const form = await request.formData();
  const family = String(form.get("family") || "").trim();
  const file = form.get("file");
  if (!/^[a-zA-Z0-9 ._-]+$/.test(family) || family.length > 120 || !(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024 || (!FONT_CONTENT_TYPES.has(file.type) && !FONT_EXTENSION.test(file.name))) {
    return NextResponse.json({ error: "Sube una fuente .woff, .woff2, .ttf u .otf de máximo 10 MB." }, { status: 400 });
  }
  const extension = file.name.split(".").pop()?.toLowerCase() || "woff2";
  const path = `organization-fonts/${context.organizationId}/${randomUUID()}.${extension}`;
  const { error: uploadError } = await context.admin.storage.from("production-assets").upload(path, await file.arrayBuffer(), { contentType: file.type || "font/woff2", upsert: false });
  if (uploadError) return NextResponse.json({ error: "No se pudo cargar el archivo de fuente." }, { status: 500 });
  const { data, error } = await context.admin.from("organization_slide_fonts").insert({
    organization_id: context.organizationId, created_by: context.userId, family, source: "uploaded", storage_path: path,
  }).select("id, family, source, css_url, storage_path, created_at").single();
  if (error) return NextResponse.json({ error: "La fuente se cargó, pero no se pudo registrar." }, { status: 500 });
  const cssUrl = context.admin.storage.from("production-assets").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({ success: true, font: { ...data, cssUrl } }, { status: 201 });
}
