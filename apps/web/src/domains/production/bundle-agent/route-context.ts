import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import type { BundleAgentAuthContext } from "./types";

export async function resolveBundleAgentAuthContext(): Promise<BundleAgentAuthContext> {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) {
    throw new Error("No autorizado.");
  }

  const tenant = await resolveActiveTenantContext();
  if (!tenant?.organizationId) {
    throw new Error("No se encontro organizacion activa.");
  }

  return {
    admin: getServiceRoleClient(),
    organizationId: tenant.organizationId,
    userId: user.userId,
    platformRole: tenant.platformRole,
  };
}
