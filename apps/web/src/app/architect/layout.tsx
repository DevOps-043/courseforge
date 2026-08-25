import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import ArchitectLayoutClient from './ArchitectLayoutClient';
import { logoutAction } from '../login/actions';
import { resolveSidebarProfile } from '@/components/layout/layout.types';
import { normalizePlatformRole } from '@/utils/auth/platform-role';

export default async function ArchitectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // 1. Verify Session
  let { data: { user } } = await supabase.auth.getUser();

  let bridgeUser = null;
  if (!user) {
    bridgeUser = await getAuthBridgeUser();
    if (!bridgeUser) {
      redirect('/login');
    }
  }

  const userId = user?.id || bridgeUser?.id;
  const userEmail = user?.email || bridgeUser?.email;

  // 2. Verify Architect Role
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, first_name, last_name_father, platform_role')
    .eq('id', userId)
    .single();

  const effectiveRole =
    normalizePlatformRole(bridgeUser?.platform_role) ||
    normalizePlatformRole(profile?.platform_role);
  const isArchitectOrAdmin = effectiveRole === 'ARQUITECTO' || effectiveRole === 'ADMIN' || effectiveRole === 'SUPERADMIN';

  if (!isArchitectOrAdmin) {
    redirect('/builder?error=unauthorized_architect');
  }

  const displayProfile = {
    ...(resolveSidebarProfile(profile, bridgeUser) || {}),
    platform_role: effectiveRole,
  };

  return (
    <ArchitectLayoutClient userEmail={userEmail} logoutAction={logoutAction} profile={displayProfile}>
      {children}
    </ArchitectLayoutClient>
  );
}
