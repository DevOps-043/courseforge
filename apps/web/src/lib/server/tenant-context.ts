import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getAuthBridgeUser } from "@/utils/auth/session";
import { loadCurrentUserMemberships, type VerifiedOrganizationMembership } from "./tenant-memberships";
import { TenantContextLookupError } from "./tenant-context-error";
export { TenantContextLookupError } from "./tenant-context-error";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/server/env";
import {
  normalizePlatformRole,
} from "@/utils/auth/platform-role";
import { runTenantLookupWithRetry } from "@/lib/server/tenant-lookup-retry";

export interface TenantContext {
  organizationId: string;
  organizationRole: string;
  organizationSlug: string;
  userId: string;
  userEmail?: string | null;
  platformRole: string | null;
}

interface OrganizationUserRoleRecord {
  platform_role?: string | null;
}

const TENANT_APP_SEGMENTS = new Set(["admin", "architect", "builder"]);

function getAdminClient() {
  return createAdminClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
}

function normalizePathSegment(segment: string | null | undefined) {
  return segment?.trim().toLowerCase() || null;
}

function getOrganizationBySlug(
  organizations: VerifiedOrganizationMembership[],
  organizationSlug?: string | null,
) {
  const normalizedSlug = normalizePathSegment(organizationSlug);
  if (!normalizedSlug) return null;

  return (
    organizations.find(
      (organization) =>
        normalizePathSegment(organization.slug) === normalizedSlug,
    ) || null
  );
}

export const getOrganizationPlatformRole = cache(async (
  userId: string,
  organizationId: string,
) => {
  const { data, error } = await runTenantLookupWithRetry(async (signal) => {
    const admin = getAdminClient();
    return admin
      .from("organization_user_roles")
      .select("platform_role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .abortSignal(signal)
      .maybeSingle();
  });

  if (error) {
    console.error("[TenantContext] No se pudo verificar el rol de la organización.");
    throw new TenantContextLookupError();
  }

  return ((data || null) as OrganizationUserRoleRecord | null)?.platform_role || null;
});

export async function upsertOrganizationPlatformRole(params: {
  organizationId: string;
  platformRole: string;
  source?: string;
  userId: string;
}) {
  const admin = getAdminClient();
  const { error } = await admin
    .from("organization_user_roles")
    .upsert(
      {
        organization_id: params.organizationId,
        user_id: params.userId,
        platform_role: params.platformRole,
        source: params.source || "courseforge",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id" },
    );

  if (error) {
    console.error("[TenantContext] Error upserting organization role:", error.message);
  }

  return !error;
}

export const getOrganizationsFromSession = cache(async () => {
  const bridgeUser = await getAuthBridgeUser();
  const organizations = bridgeUser?.id
    ? await loadCurrentUserMemberships(bridgeUser.id)
    : [];

  return {
    bridgeUser,
    organizations,
  };
});

export const resolveTenantContext = cache(async (
  organizationSlug?: string | null,
): Promise<TenantContext | null> => {
  const { bridgeUser, organizations } = await getOrganizationsFromSession();
  if (!bridgeUser?.id || organizations.length === 0) {
    return null;
  }

  const organization = getOrganizationBySlug(organizations, organizationSlug);
  if (!organization) {
    return null;
  }

  const storedOrganizationPlatformRole = await getOrganizationPlatformRole(
    bridgeUser.id,
    organization.id,
  );
  const organizationPlatformRole = normalizePlatformRole(storedOrganizationPlatformRole);
  if (!organizationPlatformRole) return null;

  return {
    organizationId: organization.id,
    organizationRole: organization.role,
    organizationSlug: organization.slug,
    userId: bridgeUser.id,
    userEmail: bridgeUser.email,
    platformRole: organizationPlatformRole,
  };
});

export async function resolveDefaultTenantPath(targetPath = "/admin") {
  const { bridgeUser, organizations } = await getOrganizationsFromSession();
  if (!bridgeUser?.id || organizations.length === 0) {
    return null;
  }

  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get("cf_active_org")?.value;
  const activeOrganization =
    organizations.find((organization) => organization.id === activeOrgId) ||
    organizations.find(
      (organization) =>
        organization.id === bridgeUser.active_organization_id,
    ) ||
    organizations[0];

  return buildTenantPath(activeOrganization.slug, targetPath);
}

export const resolveTenantContextByOrganizationId = cache(async (organizationId: string) => {
  const { organizations } = await getOrganizationsFromSession();
  const organization = organizations.find((candidate) => candidate.id === organizationId);
  if (!organization) return null;
  const tenant = await resolveTenantContext(organization.slug);
  return tenant?.organizationId === organizationId ? tenant : null;
});

export function buildTenantPath(organizationSlug: string, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `/${organizationSlug}${normalizedPath}`;
}

export function stripTenantFromPath(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && TENANT_APP_SEGMENTS.has(segments[1])) {
    return `/${segments.slice(1).join("/")}`;
  }

  return pathname || "/";
}

export async function resolveTenantContextFromHeaders() {
  const headersList = await headers();
  const referer = headersList.get("referer");
  if (!referer) return null;

  try {
    const pathSegments = new URL(referer).pathname.split("/").filter(Boolean);
    const [organizationSlug, appSegment] = pathSegments;
    if (!organizationSlug || !TENANT_APP_SEGMENTS.has(appSegment || "")) {
      return null;
    }

    return resolveTenantContext(organizationSlug);
  } catch {
    return null;
  }
}

export async function resolveActiveTenantContext() {
  const contextFromHeaders = await resolveTenantContextFromHeaders();
  if (contextFromHeaders) return contextFromHeaders;

  const defaultPath = await resolveDefaultTenantPath("/admin");
  const organizationSlug = defaultPath?.split("/").filter(Boolean)[0];
  return resolveTenantContext(organizationSlug);
}
