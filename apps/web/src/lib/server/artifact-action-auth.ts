import { createClient as createAdminClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  getActiveOrganizationId,
  getAuthBridgeUser,
} from "@/utils/auth/session";
import { REVIEWER_ROLE_SET } from "@/lib/pipeline-constants";

export async function getAuthenticatedUser(supabase: any) {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (user) {
    console.log("[Auth] Logged in via GoTrue:", user.email);
    return { userId: user.id, email: user.email };
  }

  if (authError) {
    console.log("[Auth] GoTrue error or no user:", authError.message);
  }

  console.log("[Auth] Attempting Auth Bridge fallback...");
  const bridgeUser = await getAuthBridgeUser();
  if (bridgeUser) {
    console.log("[Auth] Logged in via Auth Bridge:", bridgeUser.email);
    return { userId: bridgeUser.id, email: bridgeUser.email };
  }

  console.log("[Auth] No authenticated user found in any provider");
  return null;
}

export function getServiceRoleClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function canReviewContent(userId: string) {
  const admin = getServiceRoleClient();
  const { data } = await admin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .single();

  return REVIEWER_ROLE_SET.has(data?.platform_role);
}

export async function getAccessToken(supabase: any) {
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
  const candidate =
    process.env.URL ||
    process.env.DEPLOY_URL ||
    process.env.NEXT_PUBLIC_APP_URL;

  if (candidate) {
    const normalized = candidate.replace(/\/$/, "");
    if (
      process.env.NODE_ENV !== "production" &&
      normalized.includes("localhost:3000")
    ) {
      return "http://localhost:8888";
    }

    return normalized.startsWith("http") ? normalized : `https://${normalized}`;
  }

  return "http://localhost:8888";
}

export async function assertArtifactOrgAccess(
  artifactId: string,
  activeOrgId: string | null,
) {
  const admin = getServiceRoleClient();
  const bridgeUser = await getAuthBridgeUser();
  const organizationIds = new Set<string>();

  if (activeOrgId) {
    organizationIds.add(activeOrgId);
  }
  if (bridgeUser?.active_organization_id) {
    organizationIds.add(bridgeUser.active_organization_id);
  }
  if (Array.isArray(bridgeUser?.organization_ids)) {
    bridgeUser.organization_ids.forEach((orgId) => {
      if (orgId) {
        organizationIds.add(orgId);
      }
    });
  }

  let query = admin
    .from("artifacts")
    .select("id, organization_id")
    .eq("id", artifactId);

  if (organizationIds.size > 0) {
    query = query.in("organization_id", Array.from(organizationIds));
  } else {
    query = query.is("organization_id", null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[ArtifactAccess] Error checking artifact access:", error);
    return null;
  }

  return data;
}

export async function getAuthorizedArtifactAdmin(artifactId: string) {
  const activeOrgId = await getActiveOrganizationId();
  const artifact = await assertArtifactOrgAccess(artifactId, activeOrgId);

  if (!artifact) {
    return null;
  }

  return {
    admin: getServiceRoleClient(),
    artifact,
  };
}

export async function getAuthorizedCurationRowAdmin(rowId: string) {
  const admin = getServiceRoleClient();
  const { data: row, error: rowError } = await admin
    .from("curation_rows")
    .select("id, curation_id")
    .eq("id", rowId)
    .maybeSingle();

  if (rowError) {
    console.error("[CurationRowAccess] Error loading row:", rowError);
    return null;
  }

  if (!row?.curation_id) {
    return null;
  }

  const { data: curation, error: curationError } = await admin
    .from("curation")
    .select("artifact_id")
    .eq("id", row.curation_id)
    .maybeSingle();

  if (curationError) {
    console.error("[CurationRowAccess] Error loading curation:", curationError);
    return null;
  }

  if (!curation?.artifact_id) {
    return null;
  }

  const authorized = await getAuthorizedArtifactAdmin(curation.artifact_id);
  if (!authorized) {
    return null;
  }

  return {
    admin,
    row,
    artifactId: curation.artifact_id,
  };
}
