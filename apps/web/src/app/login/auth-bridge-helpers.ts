import type { CookieOptions } from "@supabase/ssr";
import { SignJWT } from "jose";
import type {
  AuthBridgeOrganization,
  AuthBridgeProfileRecord,
  OrganizationUserRecord,
  ProfileUpsertRecord,
  SofliaUserRecord,
} from "./auth-bridge.types";

const DEFAULT_SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 365;
const ACCESS_TOKEN_MAX_AGE = 60 * 60;
const REFRESH_TOKEN_MAX_AGE = 60 * 60 * 24 * 7;

interface MutableCookieStore {
  get(name: string): { value: string } | undefined;
  set(cookie: { name: string; value: string } & Partial<CookieOptions>): void;
}

export function getCookieMaxAge(rememberMe: boolean) {
  return rememberMe ? REMEMBER_ME_MAX_AGE : DEFAULT_SESSION_MAX_AGE;
}

export function mapOrganizations(
  organizationUsers: OrganizationUserRecord[],
): AuthBridgeOrganization[] {
  return organizationUsers
    .map((organizationUser) => {
      const organizationId =
        organizationUser.organizations?.id || organizationUser.organization_id;

      if (!organizationId) {
        return null;
      }

      return {
        id: organizationId,
        name: organizationUser.organizations?.name || "Organizacion",
        slug:
          organizationUser.organizations?.slug ||
          organizationUser.organization_id ||
          organizationId,
        role: organizationUser.role || "member",
        logo_url: organizationUser.organizations?.logo_url || null,
      };
    })
    .filter((organization): organization is AuthBridgeOrganization =>
      Boolean(organization),
    );
}

export function buildOrganizationsUpsert(
  organizations: AuthBridgeOrganization[],
) {
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug || organization.id,
    logo_url: organization.logo_url,
  }));
}

export async function createAuthBridgeTokens(params: {
  jwtSecret: string;
  user: SofliaUserRecord;
  organizations: AuthBridgeOrganization[];
  activeOrgId: string | null;
}) {
  const { jwtSecret, user, organizations, activeOrgId } = params;
  const secret = new TextEncoder().encode(jwtSecret);
  const now = Math.floor(Date.now() / 1000);

  const accessToken = await new SignJWT({
    aud: "authenticated",
    role: "authenticated",
    sub: user.id,
    email: user.email,
    iss: "courseforge-auth-bridge",
    app_metadata: {
      provider: "soflia",
      organization_ids: organizations.map((organization) => organization.id),
      active_organization_id: activeOrgId,
    },
    user_metadata: {
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      display_name: user.display_name,
      avatar_url: user.profile_picture_url,
      cargo_rol: user.cargo_rol,
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_MAX_AGE)
    .setNotBefore(now)
    .sign(secret);

  const refreshToken = await new SignJWT({
    sub: user.id,
    type: "refresh",
    iss: "courseforge-auth-bridge",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + REFRESH_TOKEN_MAX_AGE)
    .sign(secret);

  return { accessToken, refreshToken };
}

export function createSupabaseCookieAdapter(
  cookieStore: MutableCookieStore,
  rememberMe: boolean,
) {
  return {
    get(name: string) {
      return cookieStore.get(name)?.value;
    },
    set(name: string, value: string, options: CookieOptions) {
      try {
        cookieStore.set({
          name,
          value,
          ...options,
          maxAge: rememberMe
            ? REMEMBER_ME_MAX_AGE
            : options.maxAge || DEFAULT_SESSION_MAX_AGE,
        });
      } catch {
        // Ignore immutable cookie contexts.
      }
    },
    remove(name: string, options: CookieOptions) {
      try {
        cookieStore.set({ name, value: "", ...options });
      } catch {
        // Ignore immutable cookie contexts.
      }
    },
  };
}

export function setAuthBridgeCookies(params: {
  cookieStore: MutableCookieStore;
  activeOrgId: string | null;
  organizations: AuthBridgeOrganization[];
  accessToken: string;
  rememberMe: boolean;
  secure: boolean;
}) {
  const {
    cookieStore,
    activeOrgId,
    organizations,
    accessToken,
    rememberMe,
    secure,
  } = params;
  const maxAge = getCookieMaxAge(rememberMe);

  if (activeOrgId) {
    cookieStore.set({
      name: "cf_active_org",
      value: activeOrgId,
      maxAge,
      path: "/",
      httpOnly: true,
      secure,
      sameSite: "lax",
    });
  }

  cookieStore.set({
    name: "cf_user_orgs",
    value: JSON.stringify(organizations),
    maxAge,
    path: "/",
    httpOnly: false,
    secure,
    sameSite: "lax",
  });

  cookieStore.set({
    name: "cf_access_token",
    value: accessToken,
    maxAge: ACCESS_TOKEN_MAX_AGE,
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
  });

  cookieStore.set({
    name: "cf_remember_me",
    value: rememberMe ? "true" : "false",
    maxAge,
    path: "/",
    httpOnly: true,
    secure,
    sameSite: "lax",
  });
}

export function buildProfileUpsert(
  user: SofliaUserRecord,
): ProfileUpsertRecord {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    first_name: user.first_name,
    last_name_father: user.last_name,
    avatar_url: user.profile_picture_url,
  };
}

export function resolveRedirectTo(profile: AuthBridgeProfileRecord | null) {
  if (
    profile?.platform_role === "ADMIN" ||
    profile?.platform_role === "SUPERADMIN"
  ) {
    return "/admin";
  }

  if (profile?.platform_role === "ARQUITECTO") {
    return "/architect";
  }

  if (profile?.platform_role === "CONSTRUCTOR") {
    return "/builder";
  }

  return "/builder";
}
