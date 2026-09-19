export const PLATFORM_PERMISSIONS = {
  AI_USAGE_READ: "PLATFORM_AI_USAGE_READ",
} as const;

export type PlatformPermission =
  (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

function normalizeSofliaRole(role: string | null | undefined) {
  return (role || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

/**
 * Global platform permissions come only from the explicit Soflia Learning
 * platform role. Organization roles must never be passed to this function.
 */
export function getSofliaPlatformPermissions(
  platformRole: string | null | undefined,
): PlatformPermission[] {
  return normalizeSofliaRole(platformRole) === "ADMINISTRADOR"
    ? [PLATFORM_PERMISSIONS.AI_USAGE_READ]
    : [];
}

export function hasPlatformPermission(
  permissions: readonly string[] | null | undefined,
  permission: PlatformPermission,
) {
  return Boolean(permissions?.includes(permission));
}
