import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSofliaInboxEnv } from "@/lib/server/env";
import { getAuthBridgeUser } from "@/utils/auth/session";
import {
  getSofliaPlatformPermissions,
  hasPlatformPermission,
  type PlatformPermission,
} from "@/utils/auth/platform-permissions";

interface SofliaPlatformUser {
  display_name?: string | null;
  email?: string | null;
  first_name?: string | null;
  is_banned?: boolean | null;
  last_name?: string | null;
  platform_role?: string | null;
}

export interface PlatformAuthorizationContext {
  displayName: string;
  email: string;
  permissions: PlatformPermission[];
  platformRole: string | null;
  userId: string;
}

/**
 * Revalidates the authority in Soflia Learning on every protected request.
 * The JWT claim is useful for navigation only; it is deliberately not the
 * authority for sensitive platform routes because bridge sessions last days.
 */
export const getPlatformAuthorizationContext = cache(async (): Promise<PlatformAuthorizationContext | null> => {
  const bridgeUser = await getAuthBridgeUser();
  if (!bridgeUser?.id) return null;

  try {
    const { url, key } = getSofliaInboxEnv();
    const sofliaAdmin = createAdminClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await sofliaAdmin
      .from("users")
      .select("email, first_name, last_name, display_name, platform_role, is_banned")
      .eq("id", bridgeUser.id)
      .maybeSingle();

    if (error || !data) {
      console.warn("[PlatformAuthorization] Soflia permission lookup failed", {
        message: error?.message || "user_not_found",
        userId: bridgeUser.id,
      });
      return null;
    }

    const user = data as SofliaPlatformUser;
    if (user.is_banned) return null;

    const permissions = getSofliaPlatformPermissions(user.platform_role);
    const displayName =
      user.display_name?.trim() ||
      [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
      user.email ||
      bridgeUser.email;

    return {
      displayName,
      email: user.email || bridgeUser.email,
      permissions,
      platformRole: user.platform_role || null,
      userId: bridgeUser.id,
    };
  } catch (error) {
    console.warn("[PlatformAuthorization] Soflia permission lookup unavailable", {
      message: error instanceof Error ? error.message : String(error),
      userId: bridgeUser.id,
    });
    return null;
  }
});

export async function userHasPlatformPermission(permission: PlatformPermission) {
  const context = await getPlatformAuthorizationContext();
  return Boolean(context && hasPlatformPermission(context.permissions, permission));
}

export async function requirePlatformPermission(permission: PlatformPermission) {
  const context = await getPlatformAuthorizationContext();
  if (!context) redirect("/login?error=platform_authorization_unavailable");
  if (!hasPlatformPermission(context.permissions, permission)) {
    redirect("/login?error=unauthorized");
  }
  return context;
}
