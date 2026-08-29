import { NextResponse } from "next/server";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { CompositionPresetApplicationError } from "@/domains/production/composition-editor/composition-preset-application.service";
import { CompositionPresetStoreError } from "@/domains/production/composition-editor/composition-preset-store.service";
import { createClient } from "@/utils/supabase/server";

export async function authorizeCompositionPresetRequest() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  if (!(await canReviewContent(user.userId, tenant))) {
    return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}

export function compositionPresetErrorResponse(error: CompositionPresetApplicationError | CompositionPresetStoreError) {
  return NextResponse.json({
    error: error.message,
    code: error.code,
    retryable: error instanceof CompositionPresetStoreError ? error.retryable : false,
  }, { status: error.status });
}

export const COMPOSITION_PRESET_PREVIEW_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data:; media-src 'self' https: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

