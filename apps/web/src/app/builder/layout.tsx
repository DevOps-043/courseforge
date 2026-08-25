import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import BuilderLayoutClient from './BuilderLayoutClient';
import { logoutAction } from '../login/actions';
import { resolveSidebarProfile } from '@/components/layout/layout.types';
import { normalizePlatformRole } from '@/utils/auth/platform-role';

export default async function BuilderLayout({
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

  // 2. Verify Role
  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, first_name, last_name_father, platform_role')
    .eq('id', userId)
    .single();

  // Permitir CONSTRUCTOR o roles superiores
  const effectiveRole =
    normalizePlatformRole(bridgeUser?.platform_role) ||
    normalizePlatformRole(profile?.platform_role);
  const isConstructor = effectiveRole === 'CONSTRUCTOR' || !effectiveRole;
  const isHigherRole = effectiveRole === 'ADMIN' || effectiveRole === 'ARQUITECTO' || effectiveRole === 'SUPERADMIN';

  if (!isConstructor && !isHigherRole) {
    redirect('/login?error=unknown_role');
  }

  const displayProfile = {
    ...(resolveSidebarProfile(profile, bridgeUser) || {}),
    platform_role: effectiveRole,
  };

  return (
    <BuilderLayoutClient userEmail={userEmail} logoutAction={logoutAction} profile={displayProfile}>
      {children}
    </BuilderLayoutClient>
  );
}
