import { createServerClient } from "@supabase/ssr";
import {
  createClient as createAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import {
  authenticateSofliaPassword,
  SOFLIA_USER_SELECT,
} from "./auth-bridge-contract";
import {
  buildOrganizationsUpsert,
  buildProfileUpsert,
  createAuthBridgeTokens,
  createSupabaseCookieAdapter,
  mapOrganizations,
  resolveRedirectTo,
  setAuthBridgeCookies,
} from "./auth-bridge-helpers";
import type {
  AuthBridgeProfileRecord,
  LoginResult,
  OrganizationUserRecord,
  SofliaUserRecord,
} from "./auth-bridge.types";
import {
  getCourseforgeJwtSecret,
  getSofliaAuthSupabaseAnonKey,
  getSofliaInboxEnv,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isProductionEnvironment,
} from "@/lib/server/env";
import { getErrorMessage } from "@/lib/errors";
import {
  getOrganizationPlatformRole,
  upsertOrganizationPlatformRole,
} from "@/lib/server/tenant-context";

async function syncOrganizations(
  courseforgeAdmin: SupabaseClient,
  organizations: ReturnType<typeof mapOrganizations>,
) {
  if (organizations.length === 0) {
    return;
  }

  const { error } = await courseforgeAdmin
    .from("organizations")
    .upsert(buildOrganizationsUpsert(organizations), { onConflict: "id" });

  if (error) {
    console.error("Error sincronizando organizaciones localmente:", error);
  }
}

async function logLoginSession(
  courseforgeAdmin: SupabaseClient,
  userId: string,
) {
  try {
    const headersList = await headers();
    const ip = headersList.get("x-forwarded-for") || "unknown";
    const userAgent = headersList.get("user-agent") || "unknown";

    await courseforgeAdmin.from("login_history").insert({
      user_id: userId,
      ip_address: ip,
      user_agent: userAgent,
    });
  } catch (error) {
    console.error("Error logging session:", error);
  }
}

async function syncProfileAndResolveRedirect(
  courseforgeAdmin: SupabaseClient,
  user: SofliaUserRecord,
) {
  try {
    const { data: legacyProfile } = await courseforgeAdmin
      .from("profiles")
      .select("id, platform_role")
      .eq("email", user.email)
      .neq("id", user.id)
      .single();

    if (legacyProfile) {
      const { error: migrationError } = await courseforgeAdmin
        .from("profiles")
        .update({ id: user.id })
        .eq("id", legacyProfile.id);

      if (migrationError) {
        console.error("Error migrando perfil legacy:", migrationError);
      }
    }

    const { data: profileData } = await courseforgeAdmin
      .from("profiles")
      .upsert(buildProfileUpsert(user), { onConflict: "id" })
      .select("platform_role")
      .single();

    const profile = (profileData || null) as AuthBridgeProfileRecord | null;

    return resolveRedirectTo(profile);
  } catch (error) {
    console.error("Error sincronizando el perfil o verificando roles:", error);
    return "/builder";
  }
}

function mapSofliaOrganizationRoleToPlatformRole(role: string | null) {
  if (role === "owner" || role === "admin") return "ADMIN";
  return "CONSTRUCTOR";
}

async function syncOrganizationRoles(
  organizations: ReturnType<typeof mapOrganizations>,
  userId: string,
) {
  await Promise.all(
    organizations.map((organization) =>
      upsertOrganizationPlatformRole({
        organizationId: organization.id,
        platformRole: mapSofliaOrganizationRoleToPlatformRole(organization.role),
        source: "soflia",
        userId,
      }),
    ),
  );
}

async function resolveOrganizationRedirect(
  courseforgeAdmin: SupabaseClient,
  organizations: ReturnType<typeof mapOrganizations>,
  user: SofliaUserRecord,
  activeOrgId: string | null,
) {
  const legacyRedirect = await syncProfileAndResolveRedirect(courseforgeAdmin, user);
  await syncOrganizationRoles(organizations, user.id);

  if (!activeOrgId) return legacyRedirect;

  const organizationRole = await getOrganizationPlatformRole(user.id, activeOrgId);
  if (organizationRole === "ADMIN" || organizationRole === "SUPERADMIN") {
    return "/admin";
  }

  if (organizationRole === "ARQUITECTO") {
    return "/architect";
  }

  if (organizationRole === "CONSTRUCTOR") {
    return "/builder";
  }

  return legacyRedirect;
}

export async function completeAuthBridgeLogin(
  identifier: string,
  password: string,
  rememberMe: boolean,
): Promise<LoginResult> {
  if (!identifier || !password) {
    return { error: "Por favor completa todos los campos" };
  }

  try {
    const cookieStore = await cookies();
    const { url: sofliaUrl, key: sofliaKey } = getSofliaInboxEnv();
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
    const jwtSecret = getCourseforgeJwtSecret();
    const sofliaAuthAnonKey = getSofliaAuthSupabaseAnonKey();
    const secureCookies = isProductionEnvironment();

    const sofliaAdmin = createAdminClient(sofliaUrl, sofliaKey);
    const sofliaAuth = createAdminClient(sofliaUrl, sofliaAuthAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const courseforgeAdmin = createAdminClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    );
    const identifierColumn = identifier.includes("@") ? "email" : "username";

    const { data: rawUser, error: userError } = await sofliaAdmin
      .from("users")
      .select(SOFLIA_USER_SELECT)
      .ilike(identifierColumn, identifier)
      .single();

    const user = rawUser as SofliaUserRecord | null;
    if (userError || !user) {
      return { error: "Usuario no encontrado" };
    }

    if (user.is_banned) {
      return {
        error: "Tu cuenta ha sido suspendida. Contacta al administrador.",
      };
    }

    const authResult = await authenticateSofliaPassword({
      authClient: sofliaAuth,
      email: user.email,
      expectedUserId: user.id,
      password,
    });
    if (!authResult.success) {
      console.warn("Learning Auth rejected Engine bridge login", {
        code: authResult.failure.code,
        userId: user.id,
      });
      return { error: authResult.failure.message };
    }

    const { data: rawOrganizationUsers } = await sofliaAdmin
      .from("organization_users")
      .select(
        `
        role,
        organization_id,
        organizations (
          id,
          name,
          slug,
          logo_url
        )
      `,
      )
      .eq("user_id", user.id)
      .eq("status", "active");

    const organizations = mapOrganizations(
      ((rawOrganizationUsers || []) as unknown) as OrganizationUserRecord[],
    );
    const activeOrgId = organizations[0]?.id || null;

    await syncOrganizations(courseforgeAdmin, organizations);

    const { accessToken, refreshToken } = await createAuthBridgeTokens({
      jwtSecret,
      user,
      organizations,
      activeOrgId,
    });

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: createSupabaseCookieAdapter(cookieStore, rememberMe),
    });

    const { error: setSessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (setSessionError) {
      console.error("Error setting session:", setSessionError);
      console.warn("Falling back to cookie-only auth");
    }

    try {
      setAuthBridgeCookies({
        cookieStore,
        activeOrgId,
        organizations,
        accessToken,
        rememberMe,
        secure: secureCookies,
      });
    } catch (error) {
      console.error("Error setting cookies:", error);
    }

    await sofliaAdmin
      .from("users")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", user.id);

    await logLoginSession(courseforgeAdmin, user.id);

    const redirectTo = await resolveOrganizationRedirect(
      courseforgeAdmin,
      organizations,
      user,
      activeOrgId,
    );
    return { success: true, redirectTo };
  } catch (error) {
    console.error("completeAuthBridgeLogin error:", error);
    return { error: getErrorMessage(error) };
  }
}
