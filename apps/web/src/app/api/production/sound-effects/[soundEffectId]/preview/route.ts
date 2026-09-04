import { NextResponse } from "next/server";
import { z } from "zod";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getReadySoundEffectStorageIdentity,
  SoundEffectLibraryError,
  SOUND_EFFECT_PREVIEW_URL_TTL_SECONDS,
} from "@/domains/production/sound-effects/sound-effect-library.service";
import { createClient } from "@/utils/supabase/server";

interface RouteContext { params: Promise<{ soundEffectId: string }>; }

/** Redirects a tenant-authorized request to a short-lived private Storage URL. */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const authorization = await authorize();
    if (authorization instanceof NextResponse) return authorization;
    const { soundEffectId } = await context.params;
    const asset = await getReadySoundEffectStorageIdentity({
      organizationId: authorization.organizationId,
      soundEffectAssetId: z.string().uuid().parse(soundEffectId),
      supabase: authorization.admin,
    });
    const relativePath = toBucketRelativePath(asset.storageBucket, asset.storagePath);
    const { data, error } = await authorization.admin.storage
      .from(asset.storageBucket)
      .createSignedUrl(relativePath, SOUND_EFFECT_PREVIEW_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) throw error || new Error("No se pudo firmar el audio.");
    return NextResponse.redirect(data.signedUrl, {
      headers: { "Cache-Control": "private, no-store" },
      status: 302,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Identificador de efecto inválido." }, { status: 400 });
    if (error instanceof SoundEffectLibraryError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[API /production/sound-effects/:id/preview] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo preparar el audio para la preescucha." }, { status: 500 });
  }
}

async function authorize() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return NextResponse.json({ error: "No tienes permisos para escuchar efectos de sonido." }, { status: 403 });
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId };
}

function toBucketRelativePath(bucket: string, storedPath: string) {
  const prefix = `${bucket}/`;
  const path = storedPath.startsWith(prefix) ? storedPath.slice(prefix.length) : storedPath;
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) throw new Error("Ruta de audio insegura.");
  return path;
}
