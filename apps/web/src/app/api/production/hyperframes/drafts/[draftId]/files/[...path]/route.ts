import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { assertSafeDraftRelativePath, contentVersion, HyperframesDraftError } from "@/domains/production/hyperframes/hyperframes-draft.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ draftId: string; path: string[] }>; }
const writeSchema = z.object({ content: z.string().max(1_000_000) }).strict();

export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const file = await getDraftFile({ ...authorization, ...await readParams(context) });
    const { data, error } = await authorization.admin.storage
      .from(file.storage_bucket)
      .download(toBucketRelativePath(file.storage_bucket, file.storage_path));
    if (error) throw error;
    return NextResponse.json({ content: await data.text(), path: file.relative_path, version: file.content_version });
  } catch (error) {
    return respondFileError(error, "No se pudo leer el archivo de edición.");
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const params = await readParams(context);
    const file = await getDraftFile({ ...authorization, ...params });
    const expectedVersion = request.headers.get("if-match")?.replaceAll('"', "");
    if (!expectedVersion || expectedVersion !== file.content_version) {
      return NextResponse.json({ error: "El archivo cambió en otra sesión. Recarga antes de guardar.", version: file.content_version }, { status: 409 });
    }
    const input = writeSchema.parse(await request.json().catch(() => ({})));
    const nextVersion = contentVersion(input.content);
    const { error: uploadError } = await authorization.admin.storage
      .from(file.storage_bucket)
      .update(toBucketRelativePath(file.storage_bucket, file.storage_path), input.content, { contentType: file.content_type });
    if (uploadError) throw uploadError;
    const now = new Date().toISOString();
    const { error: updateError } = await authorization.admin
      .from("video_composition_draft_files")
      .update({ checksum: nextVersion, content_version: nextVersion, file_size_bytes: Buffer.byteLength(input.content, "utf8"), updated_at: now })
      .eq("id", file.id)
      .eq("content_version", expectedVersion);
    if (updateError) throw updateError;
    return NextResponse.json({ path: file.relative_path, version: nextVersion });
  } catch (error) {
    return respondFileError(error, "No se pudo guardar el archivo de edición.");
  }
}

async function readParams(context: RouteContext) {
  const { draftId, path } = await context.params;
  return { draftId: z.string().uuid().parse(draftId), relativePath: assertSafeDraftRelativePath(path.join("/")) };
}

async function getDraftFile(params: { admin: ReturnType<typeof getServiceRoleClient>; draftId: string; organizationId: string; relativePath: string }) {
  const { data, error } = await params.admin
    .from("video_composition_draft_files")
    .select("id, relative_path, storage_bucket, storage_path, content_type, content_version")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .eq("relative_path", params.relativePath)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HyperframesDraftError("Archivo de edición no encontrado.", 404);
  return data;
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId };
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new HyperframesDraftError("Ruta de archivo insegura.");
  return path;
}

function respondFileError(error: unknown, fallback: string) {
  if (error instanceof z.ZodError || error instanceof HyperframesDraftError) {
    return NextResponse.json({ error: error.message }, { status: error instanceof HyperframesDraftError ? error.status : 400 });
  }
  console.error("[API /production/hyperframes/drafts/:id/files] Unexpected error:", { message: getErrorMessage(error) });
  return NextResponse.json({ error: fallback }, { status: 500 });
}
