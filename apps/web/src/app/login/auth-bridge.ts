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
import {
  mapOrganizationRoleToPlatformRole,
  normalizePlatformRole,
} from "@/utils/auth/platform-role";

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

async function syncOrganizationRoles(
  organizations: ReturnType<typeof mapOrganizations>,
  userId: string,
) {
  await Promise.all(
    organizations.map((organization) =>
      upsertOrganizationPlatformRole({
        organizationId: organization.id,
        platformRole: mapOrganizationRoleToPlatformRole(organization.role),
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

  const activeOrganization = organizations.find(
    (organization) => organization.id === activeOrgId,
  );
  const storedOrganizationRole = await getOrganizationPlatformRole(
    user.id,
    activeOrgId,
  );
  const organizationRole =
    normalizePlatformRole(storedOrganizationRole) ||
    mapOrganizationRoleToPlatformRole(activeOrganization?.role);
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
  return completeAuthBridgeLoginInternal(identifier, password, rememberMe);
}

export async function completeAuthBridgeSsoLogin(accessToken: string): Promise<LoginResult> {
  return completeAuthBridgeLoginInternal('', '', true, accessToken);
}

async function completeAuthBridgeLoginInternal(
  identifier: string,
  password: string,
  rememberMe: boolean,
  sofiaAccessToken?: string,
): Promise<LoginResult> {
  if (!sofiaAccessToken && (!identifier || !password)) {
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

    const nativeUser = sofiaAccessToken ? await sofliaAuth.auth.getUser(sofiaAccessToken) : null;
    if (nativeUser && (nativeUser.error || !nativeUser.data.user)) return { error: 'La sesión de Soflia no es válida.' };
    const profileQuery = sofliaAdmin
      .from("users")
      .select(SOFLIA_USER_SELECT);
    const { data: rawUser, error: userError } = await (nativeUser?.data.user
      ? profileQuery.eq('id', nativeUser.data.user.id)
      : profileQuery.ilike(identifierColumn, identifier)).single();

    const user = rawUser as SofliaUserRecord | null;
    if (userError || !user) {
      return { error: "Usuario no encontrado" };
    }

    if (user.is_banned) {
      return {
        error: "Tu cuenta ha sido suspendida. Contacta al administrador.",
      };
    }

    const authResult = sofiaAccessToken ? { success: true as const } : await authenticateSofliaPassword({
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

    let organizationQuery = sofliaAdmin
      .from("organization_users")
      .select(
        `
        role,
        organization_id,
        ${sofiaAccessToken ? 'organizations!inner' : 'organizations'} (
          id,
          name,
          slug,
          logo_url
        )
      `,
      )
      .eq("user_id", user.id)
      .eq("status", "active");
    if (sofiaAccessToken) organizationQuery = organizationQuery.eq('organizations.is_active', true);
    const { data: rawOrganizationUsers, error: organizationError } = await organizationQuery;
    if (sofiaAccessToken && organizationError) return { error: 'No se pudo verificar la membresía.' };

    const organizations = mapOrganizations(
      ((rawOrganizationUsers || []) as unknown) as OrganizationUserRecord[],
    );
    if (sofiaAccessToken && organizations.length === 0) return { error: 'No existe una membresía activa.' };
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
      if (sofiaAccessToken) throw error;
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
