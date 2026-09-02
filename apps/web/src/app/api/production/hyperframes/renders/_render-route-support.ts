import { NextResponse } from "next/server";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";

export async function resolveAuthorizedRenderContext() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: NextResponse.json({ error: "No autorizado." }, { status: 401 }),
    };
  }
  if (!(await canReviewContent(authenticatedUser.userId))) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: NextResponse.json(
        { error: "No tienes permisos para consultar renders de HyperFrames." },
        { status: 403 },
      ),
    };
  }
  const tenant = await resolveActiveTenantContext();
  if (!tenant) {
    return {
      admin: null as never,
      organizationId: null as never,
      response: NextResponse.json(
        { error: "Empresa no válida o no autorizada." },
        { status: 403 },
      ),
    };
  }
  return {
    admin: getServiceRoleClient(),
    organizationId: tenant.organizationId,
    response: null,
  };
}
