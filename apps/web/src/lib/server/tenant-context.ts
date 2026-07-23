import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { getAuthBridgeUser, getUserOrganizations } from "@/utils/auth/session";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/server/env";

export interface TenantContext {
  organizationId: string;
  organizationRole: string;
  organizationSlug: string;
  userId: string;
  userEmail?: string | null;
  platformRole: string | null;
}

interface OrganizationCookieRecord {
  id: string;
  name?: string;
  role: string;
  slug: string;
}

interface ProfileRoleRecord {
  platform_role?: string | null;
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

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return String(error);
}

function isTransientFetchError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("terminated")
  );
}

function logTenantLookupError(label: string, error: unknown) {
  const message = getErrorMessage(error);
  if (isTransientFetchError(error)) {
    console.warn(`[TenantContext] ${label}: ${message}`);
    return;
  }

  console.error(`[TenantContext] ${label}:`, message);
}

function getOrganizationBySlug(
  organizations: OrganizationCookieRecord[],
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

async function getProfilePlatformRole(userId: string) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    logTenantLookupError("Error loading profile role", error);
  }

  return ((data || null) as ProfileRoleRecord | null)?.platform_role || null;
}

export async function getOrganizationPlatformRole(
  userId: string,
  organizationId: string,
) {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("organization_user_roles")
    .select("platform_role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error) {
    logTenantLookupError("Error loading organization role", error);
  }

  return ((data || null) as OrganizationUserRoleRecord | null)?.platform_role || null;
}

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

export async function getOrganizationsFromSession() {
  const bridgeUser = await getAuthBridgeUser();
  const organizationsFromCookie =
    (await getUserOrganizations()) as OrganizationCookieRecord[];

  const organizationIds = new Set(bridgeUser?.organization_ids || []);
  const organizations =
    organizationIds.size > 0
      ? organizationsFromCookie.filter((organization) =>
          organizationIds.has(organization.id),
        )
      : organizationsFromCookie;

  return {
    bridgeUser,
    organizations,
  };
}

export async function resolveTenantContext(
  organizationSlug?: string | null,
): Promise<TenantContext | null> {
  const { bridgeUser, organizations } = await getOrganizationsFromSession();
  if (!bridgeUser?.id || organizations.length === 0) {
    return null;
  }

  const organization = getOrganizationBySlug(organizations, organizationSlug);
  if (!organization) {
    return null;
  }

  const platformRole = bridgeUser.platform_role || await getProfilePlatformRole(bridgeUser.id);
  const organizationPlatformRole = await getOrganizationPlatformRole(
    bridgeUser.id,
    organization.id,
  );

  return {
    organizationId: organization.id,
    organizationRole: organization.role,
    organizationSlug: organization.slug,
    userId: bridgeUser.id,
    userEmail: bridgeUser.email,
    platformRole: organizationPlatformRole || platformRole,
  };
}

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
