import { logoutAction } from "@/app/login/actions";
import { requirePlatformPermission } from "@/lib/server/platform-authorization";
import { PLATFORM_PERMISSIONS } from "@/utils/auth/platform-permissions";
import PlatformLayoutClient from "./PlatformLayoutClient";

export const dynamic = "force-dynamic";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const authorization = await requirePlatformPermission(
    PLATFORM_PERMISSIONS.AI_USAGE_READ,
  );
  const names = authorization.displayName.split(/\s+/).filter(Boolean);
  return (
    <PlatformLayoutClient
      logoutAction={logoutAction}
      profile={{
        first_name: names[0] || "Administrador",
        last_name_father: names.slice(1).join(" ") || null,
        platform_role: "ADMIN",
      }}
      userEmail={authorization.email}
    >
      {children}
    </PlatformLayoutClient>
  );
}
