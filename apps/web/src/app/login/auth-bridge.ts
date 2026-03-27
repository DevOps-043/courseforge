import { createServerClient } from "@supabase/ssr";
import {
  createClient as createAdminClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
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
  getSofliaInboxEnv,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isProductionEnvironment,
} from "@/lib/server/env";
import { getErrorMessage } from "@/lib/errors";

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
    const secureCookies = isProductionEnvironment();

    const sofliaAdmin = createAdminClient(sofliaUrl, sofliaKey);
    const courseforgeAdmin = createAdminClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    );
    const identifierColumn = identifier.includes("@") ? "email" : "username";

    const { data: rawUser, error: userError } = await sofliaAdmin
      .from("users")
      .select(
        "id, email, username, first_name, last_name, display_name, profile_picture_url, cargo_rol, is_banned, password_hash",
      )
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

    if (!user.password_hash) {
      return {
        error:
          "Esta cuenta usa autenticacion externa (OAuth). Inicia sesion con tu proveedor.",
      };
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return { error: "Contrasena incorrecta" };
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

    const redirectTo = await syncProfileAndResolveRedirect(courseforgeAdmin, user);
    return { success: true, redirectTo };
  } catch (error) {
    console.error("completeAuthBridgeLogin error:", error);
    return { error: getErrorMessage(error) };
  }
}
