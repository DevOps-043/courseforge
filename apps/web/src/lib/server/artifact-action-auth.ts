import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getAuthBridgeUser } from "@/utils/auth/session";
import type { TenantContext } from "@/lib/server/tenant-context";
import {
  resolveTenantContextByOrganizationId,
  resolveActiveTenantContext,
} from "@/lib/server/tenant-context";
import { REVIEWER_ROLE_SET } from "@/lib/pipeline-constants";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/server/env";
import { resolveBackgroundFunctionOrigin } from "./background-function-origin";

interface AuthenticatedUserLike {
  id: string;
  email?: string | null;
}

interface SupabaseAuthLike {
  auth: {
    getUser(): Promise<{
      data: { user: AuthenticatedUserLike | null };
      error: { message?: string | null } | null;
    }>;
    getSession(): Promise<{
      data: { session: { access_token: string } | null };
    }>;
  };
}

export async function getAuthenticatedUser(supabase: SupabaseAuthLike) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (user) {
    console.log("[Auth] Logged in via GoTrue");
    return { userId: user.id, email: user.email };
  }

  if (authError) {
    console.log("[Auth] GoTrue error or no user:", authError.message);
  }

  console.log("[Auth] Attempting Auth Bridge fallback...");
  const bridgeUser = await getAuthBridgeUser();
  if (bridgeUser) {
    console.log("[Auth] Logged in via Auth Bridge");
    return { userId: bridgeUser.id, email: bridgeUser.email };
  }

  console.log("[Auth] No authenticated user found in any provider");
  return null;
}

export function getServiceRoleClient() {
  return createAdminClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
  );
}

export async function canReviewContent(userId: string, resolvedTenant?: TenantContext | null) {
  if (resolvedTenant === null) return false;
  const tenant = resolvedTenant === undefined
    ? await resolveActiveTenantContext()
    : await resolveTenantContextByOrganizationId(resolvedTenant.organizationId);
  return Boolean(tenant && tenant.userId === userId && tenant.platformRole && REVIEWER_ROLE_SET.has(tenant.platformRole));
}

export async function getAccessToken(supabase: SupabaseAuthLike) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session?.access_token) {
    return session.access_token;
  }

  const cookieStore = await cookies();
  return cookieStore.get("cf_access_token")?.value || null;
}

export function getBackgroundFunctionsBaseUrl() {
  return resolveBackgroundFunctionOrigin(process.env);
}

export async function assertArtifactOrgAccess(
  artifactId: string,
  activeOrgId: string | null,
  tenantContext?: Pick<TenantContext, "organizationId"> | null,
) {
  if (tenantContext?.organizationId && activeOrgId && tenantContext.organizationId !== activeOrgId) return null;
  const requestedOrganizationId = tenantContext?.organizationId ?? activeOrgId;
  const tenant = requestedOrganizationId
    ? await resolveTenantContextByOrganizationId(requestedOrganizationId)
    : await resolveActiveTenantContext();
  if (!tenant) return null;

  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("artifacts")
    .select("id, organization_id")
    .eq("id", artifactId)
    .eq("organization_id", tenant.organizationId)
    .maybeSingle();
  if (error) {
    console.error("[ArtifactAccess] No se pudo verificar el acceso al artefacto.");
    return null;
  }
  return data?.organization_id === tenant.organizationId ? data : null;
}

export async function getAuthorizedArtifactAdmin(artifactId: string) {
  const tenantContext = await resolveActiveTenantContext();
  if (!tenantContext) return null;
  const artifact = await assertArtifactOrgAccess(
    artifactId,
    tenantContext.organizationId,
    tenantContext,
  );

  if (!artifact) {
    return null;
  }

  return {
    admin: getServiceRoleClient(),
    artifact,
  };
}

export async function getAuthorizedArtifactAdminForTenant(
  artifactId: string,
  tenantContext: Pick<TenantContext, "organizationId">,
) {
  const artifact = await assertArtifactOrgAccess(
    artifactId,
    tenantContext.organizationId,
    tenantContext,
  );

  if (!artifact) {
    return null;
  }

  return {
    admin: getServiceRoleClient(),
    artifact,
  };
}

export async function getAuthorizedCurationRowAdmin(rowId: string) {
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return null;
  const admin = getServiceRoleClient();
  const { data: row, error } = await admin
    .from("curation_rows")
    .select("id, curation_id, curation!inner(artifact_id, artifacts!inner(organization_id))")
    .eq("id", rowId)
    .eq("curation.artifacts.organization_id", tenant.organizationId)
    .maybeSingle();
  if (error) {
    console.error("[CurationRowAccess] No se pudo consultar la fila autorizada.");
    return null;
  }
  const curation = Array.isArray(row?.curation) ? row.curation[0] : row?.curation;
  if (!row?.curation_id || !curation?.artifact_id) return null;
  const authorized = await getAuthorizedArtifactAdminForTenant(curation.artifact_id, tenant);
  if (!authorized) return null;
  return {
    admin,
    row: { id: row.id, curation_id: row.curation_id },
    artifactId: curation.artifact_id,
  };
}

interface MaterialComponentAdminRow {
  assets?: Record<string, any> | null;
  content?: unknown;
  id: string;
  material_lesson_id?: string | null;
  material_lessons?:
    | {
        materials?:
          | {
              artifact_id?: string | null;
            }
          | Array<{
              artifact_id?: string | null;
            }>
          | null;
      }
    | Array<{
        materials?:
          | {
              artifact_id?: string | null;
            }
          | Array<{
              artifact_id?: string | null;
            }>
          | null;
      }>
    | null;
  type?: string | null;
}

export class MaterialComponentLookupUnavailableError extends Error {
  readonly code = "MATERIAL_COMPONENT_LOOKUP_UNAVAILABLE";
  readonly retryable = true;

  constructor() {
    super("No se pudo consultar temporalmente el componente. Intenta de nuevo.");
    this.name = "MaterialComponentLookupUnavailableError";
  }
}

function getArtifactIdFromComponent(component: MaterialComponentAdminRow) {
  const lessonRelation = Array.isArray(component.material_lessons)
    ? component.material_lessons[0]
    : component.material_lessons;
  const materialsRelation = Array.isArray(lessonRelation?.materials)
    ? lessonRelation.materials[0]
    : lessonRelation?.materials;

  return materialsRelation?.artifact_id || null;
}

export async function getAuthorizedMaterialComponentAdmin(componentId: string) {
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return null;
  return loadAuthorizedMaterialComponent(componentId, tenant.organizationId, true);
}

export async function getAuthorizedMaterialComponentAdminForTenant(
  componentId: string,
  organizationId: string,
) {
  const tenant = await resolveTenantContextByOrganizationId(organizationId);
  if (!tenant) return null;
  return loadAuthorizedMaterialComponent(componentId, tenant.organizationId, false);
}

async function loadAuthorizedMaterialComponent(
  componentId: string,
  organizationId: string,
  throwOnLookupError: boolean,
) {
  const admin = getServiceRoleClient();
  const { data: component, error } = await admin
    .from("material_components")
    .select(
      `
        id,
        type,
        content,
        assets,
        material_lesson_id,
        material_lessons!inner (
          materials!inner (
            artifact_id,
            artifacts!inner ( organization_id )
          )
        )
      `,
    )
    .eq("id", componentId)
    .eq("material_lessons.materials.artifacts.organization_id", organizationId)
    .maybeSingle();

  if (error || !component) {
    if (error) {
      console.error("[MaterialComponentAccess] No se pudo consultar el componente autorizado.");
      if (throwOnLookupError) throw new MaterialComponentLookupUnavailableError();
    }
    return null;
  }

  const normalizedComponent = component as MaterialComponentAdminRow;
  const artifactId = getArtifactIdFromComponent(normalizedComponent);
  if (!artifactId) return null;

  const authorized = await getAuthorizedArtifactAdminForTenant(artifactId, { organizationId });
  if (!authorized) return null;
  return { admin, artifactId, component: normalizedComponent };
}
