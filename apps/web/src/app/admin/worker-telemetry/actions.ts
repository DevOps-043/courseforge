"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActiveOrganizationId, getAuthBridgeUser, getUserOrganizations } from "@/utils/auth/session";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { DesktopWorkerControlPlane } from "@/lib/server/desktop-worker-control-plane";
import { resolveActiveTenantContext, resolveTenantContext } from "@/lib/server/tenant-context";

const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN"]);

export interface WorkerLinkCodeActionResult {
  code?: string;
  error?: string;
  expiresAt?: string;
  success: boolean;
}

export interface WorkerMutationActionResult {
  error?: string;
  success: boolean;
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

async function requireWorkerAdmin(organizationIdInput: string | null, organizationSlugInput?: string | null) {
  const organizationSlug = organizationSlugInput || await resolveOrganizationSlugFromRequest();
  const tenant = organizationSlug
    ? await resolveTenantContext(organizationSlug) || await resolveActiveTenantContext()
    : await resolveActiveTenantContext();
  const organizationId = await resolveValidOrganizationId({
    organizationIdInput,
    organizationSlug,
    tenantOrganizationId: tenant?.organizationId || null,
  });

  if (!isUuid(organizationId)) {
    throw new Error("organizationId must be a valid UUID");
  }
  const resolvedOrganizationId = organizationId;

  const admin = getServiceRoleClient();
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  const bridgeUser = authenticatedUser ? null : await getAuthBridgeUser();
  const userId = authenticatedUser?.userId || bridgeUser?.id;
  if (!userId) redirect("/login?error=unauthorized");

  const { data: profile } = await admin
    .from("profiles")
    .select("platform_role, organization_id")
    .eq("id", userId)
    .maybeSingle();

  const role = tenant?.platformRole || profile?.platform_role || bridgeUser?.platform_role || null;
  if (!ADMIN_ROLES.has(role || "")) redirect("/login?error=unauthorized");

  const activeOrganizationId = await getActiveOrganizationId();
  if (profile?.organization_id !== resolvedOrganizationId && activeOrganizationId !== resolvedOrganizationId) {
    const { data: memberRole } = await admin
      .from("organization_user_roles")
      .select("organization_id")
      .eq("user_id", userId)
      .eq("organization_id", resolvedOrganizationId)
      .maybeSingle();

    if (!memberRole) redirect("/login?error=unauthorized");
  }

  return { admin, organizationId: resolvedOrganizationId, userId };
}

async function getReturnTo() {
  const referer = (await headers()).get("referer");
  return referer || "/admin/worker-telemetry";
}

async function resolveOrganizationSlugFromRequest() {
  const headersList = await headers();
  const referer = headersList.get("referer");
  if (!referer) return null;

  try {
    const [organizationSlug, appSegment] = new URL(referer).pathname.split("/").filter(Boolean);
    return organizationSlug && appSegment === "admin" ? organizationSlug : null;
  } catch {
    return null;
  }
}

async function resolveOrganizationIdBySlug(organizationSlug: string | null) {
  if (!organizationSlug) return null;

  const organizationIdFromSession = await resolveOrganizationIdFromSessionOrganizations(organizationSlug);
  if (isUuid(organizationIdFromSession)) return organizationIdFromSession;

  const { data } = await getServiceRoleClient()
    .from("organizations")
    .select("id")
    .ilike("slug", organizationSlug)
    .maybeSingle();

  return typeof data?.id === "string" ? data.id : null;
}

async function resolveOrganizationIdFromSessionOrganizations(value: string | null) {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  const organizations = await getUserOrganizations();
  const organization = organizations.find((item) => {
    return (
      item.id === value ||
      item.slug?.trim().toLowerCase() === normalized ||
      item.name?.trim().toLowerCase() === normalized
    );
  });

  return organization?.id || null;
}

async function resolveValidOrganizationId(input: {
  organizationIdInput: string | null;
  organizationSlug: string | null;
  tenantOrganizationId: string | null;
}) {
  if (isUuid(input.organizationIdInput)) return input.organizationIdInput;
  if (isUuid(input.tenantOrganizationId)) return input.tenantOrganizationId;

  const slugCandidates = [
    input.organizationSlug,
    input.organizationIdInput,
    input.tenantOrganizationId,
  ].filter((value): value is string => Boolean(value && !isUuid(value)));

  for (const slug of slugCandidates) {
    const organizationId =
      await resolveOrganizationIdFromSessionOrganizations(slug) ||
      await resolveOrganizationIdBySlug(slug);
    if (isUuid(organizationId)) return organizationId;
  }

  const activeOrganizationId = await getActiveOrganizationId();
  if (isUuid(activeOrganizationId)) return activeOrganizationId;
  if (activeOrganizationId) {
    const organizationId =
      await resolveOrganizationIdFromSessionOrganizations(activeOrganizationId) ||
      await resolveOrganizationIdBySlug(activeOrganizationId);
    if (isUuid(organizationId)) return organizationId;
  }

  return null;
}

function withSearchParam(url: string, key: string, value: string) {
  const parsed = new URL(url, "http://localhost");
  parsed.searchParams.set(key, value);
  return `${parsed.pathname}${parsed.search}`;
}

export async function createWorkerLinkCode(boundOrganizationSlug: string | null, formData: FormData) {
  const organizationId = String(formData.get("organizationId") || "");
  const organizationSlug = boundOrganizationSlug || String(formData.get("organizationSlug") || "");
  const { admin, organizationId: resolvedOrganizationId, userId } = await requireWorkerAdmin(organizationId, organizationSlug);
  const result = await new DesktopWorkerControlPlane(admin).createLinkCode({
    organizationId: resolvedOrganizationId,
    userId,
    deviceName: formData.get("deviceName"),
  });

  revalidatePath("/admin/worker-telemetry");
  redirect(withSearchParam(await getReturnTo(), "workerLinkCode", result.code));
}

export async function createWorkerLinkCodeForOrganizationAction(input: {
  deviceName?: string;
  organizationId?: string | null;
  organizationSlug?: string | null;
}): Promise<WorkerLinkCodeActionResult> {
  try {
    const { admin, organizationId: resolvedOrganizationId, userId } = await requireWorkerAdmin(
      input.organizationId || null,
      input.organizationSlug || null,
    );
    const result = await new DesktopWorkerControlPlane(admin).createLinkCode({
      organizationId: resolvedOrganizationId,
      userId,
      deviceName: input.deviceName,
    });

    revalidatePath("/admin/worker-telemetry");
    return {
      success: true,
      code: result.code,
      expiresAt: result.linkCode?.expires_at,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "No se pudo crear el codigo de vinculacion.",
    };
  }
}

export async function setPrimaryBundleWorker(boundOrganizationSlug: string | null, formData: FormData) {
  const organizationId = String(formData.get("organizationId") || "");
  const organizationSlug = boundOrganizationSlug || String(formData.get("organizationSlug") || "");
  const workerId = String(formData.get("workerId") || "");
  const { admin, organizationId: resolvedOrganizationId } = await requireWorkerAdmin(organizationId, organizationSlug);
  await new DesktopWorkerControlPlane(admin).setPrimaryBundleWorker(workerId, resolvedOrganizationId);

  revalidatePath("/admin/worker-telemetry");
}

export async function setPrimaryBundleWorkerForOrganizationAction(input: {
  organizationId?: string | null;
  organizationSlug?: string | null;
  workerId: string;
}): Promise<WorkerMutationActionResult> {
  try {
    const { admin, organizationId: resolvedOrganizationId } = await requireWorkerAdmin(
      input.organizationId || null,
      input.organizationSlug || null,
    );
    await new DesktopWorkerControlPlane(admin).setPrimaryBundleWorker(input.workerId, resolvedOrganizationId);

    revalidatePath("/admin/worker-telemetry");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "No se pudo marcar el worker principal.",
    };
  }
}
