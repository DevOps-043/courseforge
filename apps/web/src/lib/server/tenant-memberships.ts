import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSofliaInboxEnv } from "./env";
import { runTenantLookupWithRetry } from "./tenant-lookup-retry";
import { TenantContextLookupError } from "./tenant-context-error";

// Rechazar un listado truncado evita elegir un tenant desde evidencia parcial.
const MAX_MEMBERSHIPS_PER_LOOKUP = 1000;
const membershipSchema = z.array(z.object({
  organization_id: z.string().uuid(),
  role: z.string().nullable(),
  organizations: z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string().trim().min(1),
    logo_url: z.string().nullable().optional(),
  }),
}));

export interface VerifiedOrganizationMembership {
  id: string;
  name: string;
  slug: string;
  role: string;
  logo_url?: string | null;
}

export async function loadCurrentUserMemberships(userId: string): Promise<VerifiedOrganizationMembership[]> {
  try {
    const { url, key } = getSofliaInboxEnv();
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await runTenantLookupWithRetry(async (signal) => {
      const result = await client.from("organization_users")
        .select("organization_id, role, organizations!inner(id, name, slug, logo_url)", { count: "exact" })
        .eq("user_id", userId)
        .eq("status", "active")
        .limit(MAX_MEMBERSHIPS_PER_LOOKUP)
        .abortSignal(signal);
      return { data: { rows: result.data, count: result.count }, error: result.error };
    });
    const parsed = membershipSchema.safeParse(data?.rows);
    if (error || !parsed.success || data?.count !== parsed.data.length) {
      throw new TenantContextLookupError();
    }
    return parsed.data.map((membership) => {
      if (membership.organization_id !== membership.organizations.id) throw new TenantContextLookupError();
      return { ...membership.organizations, role: membership.role || "member" };
    });
  } catch {
    // No registrar errores del proveedor que puedan contener URLs o credenciales.
    console.error("[TenantContext] No se pudo verificar la membresía vigente.");
    throw new TenantContextLookupError();
  }
}
