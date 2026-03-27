import type { AuthBridgeUser } from '@/utils/auth/session';

export interface SidebarProfile {
  avatar_url?: string | null;
  first_name?: string | null;
  last_name_father?: string | null;
  platform_role?: string | null;
}

export function resolveSidebarProfile(
  profile: SidebarProfile | null | undefined,
  bridgeUser?: Pick<AuthBridgeUser, 'first_name' | 'last_name' | 'avatar_url'> | null,
): SidebarProfile | null {
  if (profile) {
    return profile;
  }

  if (!bridgeUser) {
    return null;
  }

  return {
    avatar_url: bridgeUser.avatar_url ?? null,
    first_name: bridgeUser.first_name ?? null,
    last_name_father: bridgeUser.last_name ?? null,
  };
}
