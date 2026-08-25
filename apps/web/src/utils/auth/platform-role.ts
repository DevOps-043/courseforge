export const CANONICAL_PLATFORM_ROLES = [
  "ADMIN",
  "ARQUITECTO",
  "CONSTRUCTOR",
  "SUPERADMIN",
] as const;

export type CanonicalPlatformRole =
  (typeof CANONICAL_PLATFORM_ROLES)[number];

const PLATFORM_ROLE_ALIASES: Record<string, CanonicalPlatformRole> = {
  ADMIN: "ADMIN",
  ADMINISTRADOR: "ADMIN",
  ADMINISTRADORA: "ADMIN",
  ADMINISTRATOR: "ADMIN",
  ARQUITECTO: "ARQUITECTO",
  ARQUITECTA: "ARQUITECTO",
  ARCHITECT: "ARQUITECTO",
  BUILDER: "CONSTRUCTOR",
  CONSTRUCTOR: "CONSTRUCTOR",
  CONSTRUCTORA: "CONSTRUCTOR",
  EDITOR: "CONSTRUCTOR",
  INSTRUCTOR: "CONSTRUCTOR",
  SUPER_ADMIN: "SUPERADMIN",
  SUPERADMIN: "SUPERADMIN",
};

function normalizeRoleKey(role: string) {
  return role
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizePlatformRole(
  role: string | null | undefined,
): CanonicalPlatformRole | null {
  if (!role) return null;
  return PLATFORM_ROLE_ALIASES[normalizeRoleKey(role)] || null;
}

export function mapOrganizationRoleToPlatformRole(
  role: string | null | undefined,
): CanonicalPlatformRole {
  const normalizedRole = normalizeRoleKey(role || "member");

  if (normalizedRole === "OWNER" || normalizedRole === "ADMIN") {
    return "ADMIN";
  }

  if (
    normalizedRole === "ARCHITECT" ||
    normalizedRole === "ARQUITECTO" ||
    normalizedRole === "ARQUITECTA" ||
    normalizedRole === "REVIEWER"
  ) {
    return "ARQUITECTO";
  }

  return "CONSTRUCTOR";
}

export function getPlatformRoleHome(role: CanonicalPlatformRole) {
  if (role === "ADMIN" || role === "SUPERADMIN") return "/admin";
  if (role === "ARQUITECTO") return "/architect";
  return "/builder";
}
