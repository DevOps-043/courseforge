import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import { logoutAction } from '../login/actions';
import AdminLayoutClient from './AdminLayoutClient';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // 1. Verificar Sesión - intentar GoTrue primero, luego Auth Bridge
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

  // 2. Verificar Rol de Admin
  // Primero checar el cargo_rol de SofLIA (viene en el Auth Bridge JWT)
  const isAdminViaSoflia = bridgeUser?.cargo_rol === 'Administrador' || bridgeUser?.cargo_rol === 'Business';

  // También checar perfil local de CourseForge
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  const isAdminLocal = profile?.platform_role === 'ADMIN';

  if (!isAdminViaSoflia && !isAdminLocal) {
    redirect('/dashboard?error=unauthorized');
  }

  // Usar datos disponibles
  const displayProfile = profile || (bridgeUser ? {
    first_name: bridgeUser.first_name,
    last_name: bridgeUser.last_name,
    username: bridgeUser.username,
    avatar_url: bridgeUser.avatar_url,
    platform_role: 'ADMIN',
  } : null);

  return (
    <AdminLayoutClient userEmail={userEmail} logoutAction={logoutAction} profile={displayProfile}>
      {children}
    </AdminLayoutClient>
  );
}
