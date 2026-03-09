import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import ArchitectLayoutClient from './ArchitectLayoutClient';
import { logoutAction } from '../login/actions';

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
    .select('*')
    .eq('id', userId)
    .single();

  const isArchitectOrAdmin = profile?.platform_role === 'ARQUITECTO' || profile?.platform_role === 'ADMIN' || profile?.platform_role === 'SUPERADMIN';

  if (!isArchitectOrAdmin) {
    redirect('/builder?error=unauthorized_architect');
  }

  const displayProfile = profile || (bridgeUser ? {
    first_name: bridgeUser.first_name,
    last_name: bridgeUser.last_name,
    username: bridgeUser.username,
    avatar_url: bridgeUser.avatar_url,
    platform_role: 'ARQUITECTO',
  } : null);

  return (
    <ArchitectLayoutClient userEmail={userEmail} logoutAction={logoutAction} profile={displayProfile}>
      {children}
    </ArchitectLayoutClient>
  );
}
