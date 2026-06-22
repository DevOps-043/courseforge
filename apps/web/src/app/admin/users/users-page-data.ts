import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { getSofliaInboxEnv } from "@/lib/server/env";
import type { PlatformRole, PlatformUser } from "./user-management.types";

interface SofliaOrgUserRow {
  created_at?: string | null;
  role?: string | null;
  status?: string | null;
  user_id: string;
  users?: {
    created_at?: string | null;
    email?: string | null;
    first_name?: string | null;
    id: string;
    is_banned?: boolean | null;
    last_name?: string | null;
    username?: string | null;
  } | null;
}

interface LocalProfileRoleRow {
  user_id: string;
  platform_role?: PlatformRole | null;
}

function mapSofliaRoleToPlatformRole(role?: string | null): PlatformRole {
  if (role === "owner" || role === "admin") return "ADMIN";
  return "CONSTRUCTOR";
}

export async function loadUsersPageData(options?: {
  organizationId?: string | null;
}): Promise<PlatformUser[]> {
  if (!options?.organizationId) {
    const local = getServiceRoleClient();
    const { data, error } = await local
      .from("profiles")
      .select(
        "id, first_name, last_name_father, last_name_mother, username, email, platform_role, is_active, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[UsersPage] Error fetching legacy profiles:", error.message);
    }

    return (data as PlatformUser[] | null) || [];
  }

  const { url, key } = getSofliaInboxEnv();
  const sofliaAdmin = createAdminClient(url, key);

  const { data: rawMembers, error: membersError } = await sofliaAdmin
    .from("organization_users")
    .select(
      `
      user_id,
      role,
      status,
      created_at,
      users (
        id,
        username,
        email,
        first_name,
        last_name,
        is_banned,
        created_at
      )
    `,
    )
    .eq("organization_id", options.organizationId)
    .in("status", ["active", "invited"])
    .order("created_at", { ascending: false });

  if (membersError) {
    console.error("[UsersPage] Error fetching SofLIA org members:", membersError.message);
    return [];
  }

  const members = (rawMembers || []) as unknown as SofliaOrgUserRow[];
  const memberIds = members.map((member) => member.user_id).filter(Boolean);
  const localRoleByUserId = new Map<string, PlatformRole | null>();

  if (memberIds.length > 0) {
    const local = getServiceRoleClient();
    const { data: localProfiles, error: localError } = await local
      .from("organization_user_roles")
      .select("user_id, platform_role")
      .eq("organization_id", options.organizationId)
      .in("user_id", memberIds);

    if (localError) {
      console.error("[UsersPage] Error fetching local profile roles:", localError.message);
    }

    ((localProfiles || []) as LocalProfileRoleRow[]).forEach((profile) => {
      localRoleByUserId.set(profile.user_id, profile.platform_role || null);
    });
  }

  return members
    .filter((member) => member.users?.id)
    .map((member) => {
      const user = member.users!;
      return {
        id: user.id,
        username: user.username || null,
        email: user.email || null,
        first_name: user.first_name || null,
        last_name_father: user.last_name || null,
        last_name_mother: null,
        platform_role:
          localRoleByUserId.get(user.id) || mapSofliaRoleToPlatformRole(member.role),
        is_active: member.status === "active" && user.is_banned !== true,
        created_at: user.created_at || member.created_at || null,
      };
    });
}
