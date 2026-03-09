import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import BuilderLayoutClient from './BuilderLayoutClient';
import { logoutAction } from '../login/actions';

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
    .select('*')
    .eq('id', userId)
    .single();

  // Permitir CONSTRUCTOR o roles superiores
  const isConstructor = profile?.platform_role === 'CONSTRUCTOR' || !profile?.platform_role;
  const isHigherRole = profile?.platform_role === 'ADMIN' || profile?.platform_role === 'ARQUITECTO' || profile?.platform_role === 'SUPERADMIN';

  if (!isConstructor && !isHigherRole) {
    redirect('/login?error=unknown_role');
  }

  const displayProfile = profile || (bridgeUser ? {
    first_name: bridgeUser.first_name,
    last_name: bridgeUser.last_name,
    username: bridgeUser.username,
    avatar_url: bridgeUser.avatar_url,
    platform_role: profile?.platform_role || 'CONSTRUCTOR',
  } : null);

  return (
    <BuilderLayoutClient userEmail={userEmail} logoutAction={logoutAction} profile={displayProfile}>
      {children}
    </BuilderLayoutClient>
  );
}
