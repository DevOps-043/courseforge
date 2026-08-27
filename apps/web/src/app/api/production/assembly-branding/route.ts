import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import { z } from "zod";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";

const MAX_BYTES = 100 * 1024 * 1024;
const MIME_TYPES = new Set(["video/mp4", "video/webm"]);
const selectionSchema = z.object({ assetId: z.string().uuid().nullable(), kind: z.enum(["INTRO", "OUTRO"]) }).strict();

export async function GET() {
  const auth = await authorize(); if (auth instanceof NextResponse) return auth;
  const [{ data: assets, error: assetsError }, { data: settings, error: settingsError }] = await Promise.all([
    auth.admin.from("organization_assembly_assets").select("id, kind, name, mime_type, file_size_bytes, duration_milliseconds, status, created_at").eq("organization_id", auth.organizationId).neq("status", "ARCHIVED").order("created_at", { ascending: false }),
    auth.admin.from("organization_assembly_settings").select("default_intro_asset_id, default_outro_asset_id, intro_enabled, outro_enabled").eq("organization_id", auth.organizationId).maybeSingle(),
  ]);
  if (assetsError || settingsError) return NextResponse.json({ error: "No se pudo cargar la biblioteca de identidad." }, { status: 500 });
  return NextResponse.json({ success: true, data: { assets: assets || [], settings: settings || null } });
}

export async function POST(request: Request) {
  const auth = await authorize(); if (auth instanceof NextResponse) return auth;
  try {
    const form = await request.formData();
    const file = form.get("file");
    const kind = z.enum(["INTRO", "OUTRO"]).parse(form.get("kind"));
    if (!(file instanceof File)) return NextResponse.json({ error: "Selecciona un archivo de video." }, { status: 400 });
    if (!MIME_TYPES.has(file.type)) return NextResponse.json({ error: "Solo se permiten videos MP4 o WebM." }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: "El video debe pesar menos de 100 MB." }, { status: 413 });
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    let duration: number;
    let hasAudio = false;
    let sourceHeight = 0;
    let sourceWidth = 0;
    try {
      const [audioTrack, videoTrack] = await Promise.all([input.getPrimaryAudioTrack(), input.getPrimaryVideoTrack()]);
      if (!videoTrack) return NextResponse.json({ error: "El archivo no contiene una pista de video válida." }, { status: 400 });
      const [metadataDuration, height, width] = await Promise.all([
        input.getDurationFromMetadata(),
        videoTrack.getDisplayHeight(),
        videoTrack.getDisplayWidth(),
      ]);
      duration = metadataDuration ?? await input.computeDuration([videoTrack]);
      hasAudio = audioTrack !== null;
      sourceHeight = Number.isFinite(height) ? height : 0;
      sourceWidth = Number.isFinite(width) ? width : 0;
    } finally { input.dispose(); }
    if (!Number.isFinite(duration) || duration <= 0) return NextResponse.json({ error: "No se pudo medir la duración del video." }, { status: 400 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const id = randomUUID();
    const extension = file.type === "video/webm" ? "webm" : "mp4";
    const path = `assembly-branding/${auth.organizationId}/${kind.toLowerCase()}/${id}.${extension}`;
    const { error: uploadError } = await auth.admin.storage.from("production-assets").upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { error: insertError } = await auth.admin.from("organization_assembly_assets").insert({ id, organization_id: auth.organizationId, kind, name: file.name.slice(0, 160), storage_bucket: "production-assets", storage_path: path, mime_type: file.type, file_size_bytes: file.size, duration_milliseconds: Math.round(duration * 1000), checksum: createHash("sha256").update(bytes).digest("hex"), metadata: { file_name: file.name, has_audio: hasAudio, source_height: sourceHeight || null, source_width: sourceWidth || null }, status: "APPROVED", created_by: auth.userId, approved_by: auth.userId, approved_at: new Date().toISOString() });
    if (insertError) {
      await auth.admin.storage.from("production-assets").remove([path]);
      throw insertError;
    }
    return NextResponse.json({ success: true, data: { id } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Tipo de asset inválido." }, { status: 400 });
    console.error("[AssemblyBranding] Upload failed", { message: error instanceof Error ? error.message : "Unknown" });
    return NextResponse.json({ error: "No se pudo guardar el video de identidad." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await authorize(); if (auth instanceof NextResponse) return auth;
  try {
    const body = selectionSchema.parse(await request.json());
    if (body.assetId) {
      const { data } = await auth.admin.from("organization_assembly_assets").select("id").eq("id", body.assetId).eq("organization_id", auth.organizationId).eq("kind", body.kind).eq("status", "APPROVED").maybeSingle();
      if (!data) return NextResponse.json({ error: "El asset no pertenece a esta empresa o no está aprobado." }, { status: 400 });
    }
    const field = body.kind === "INTRO" ? "default_intro_asset_id" : "default_outro_asset_id";
    const enabled = body.kind === "INTRO" ? "intro_enabled" : "outro_enabled";
    const { error } = await auth.admin.from("organization_assembly_settings").upsert({ organization_id: auth.organizationId, [field]: body.assetId, [enabled]: Boolean(body.assetId), updated_by: auth.userId, updated_at: new Date().toISOString() }, { onConflict: "organization_id" });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Selección inválida." }, { status: 400 });
    return NextResponse.json({ error: "No se pudo guardar la selección." }, { status: 500 });
  }
}

async function authorize() {
  const client = await createClient(); const user = await getAuthenticatedUser(client);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) return NextResponse.json({ error: "No tienes permisos para configurar identidad de ensamble." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}
