import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import { logoutAction } from '../login/actions';
import AdminLayoutClient from './AdminLayoutClient';
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '@/lib/server/env';
import { resolveSidebarProfile } from '@/components/layout/layout.types';

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

  // 2. Verificar Rol de Admin local de CourseForge
  let { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, first_name, last_name_father, platform_role')
    .eq('id', userId)
    .single();

  // --- FALLBACK ROLE DETECTION ---
  // Si no pudimos leer el perfil con el cliente normal (puede pasar por RLS 
  // si el JWT aún no se propaga completamente), intentamos con el cliente admin.
  if (!profile) {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const cfAdmin = createAdminClient(
      getSupabaseUrl(),
      getSupabaseServiceRoleKey(),
    );
    const { data: adminProfile } = await cfAdmin
      .from('profiles')
      .select('avatar_url, first_name, last_name_father, platform_role')
      .eq('id', userId)
      .single();
    
    if (adminProfile) {
      profile = adminProfile;
    }
  }

  const hasValidRole = ['ADMIN', 'ARQUITECTO', 'CONSTRUCTOR'].includes(profile?.platform_role as string);

  if (!hasValidRole) {
    redirect('/login?error=unauthorized');
  }

  // Usar datos disponibles
  const displayProfile = resolveSidebarProfile(profile, bridgeUser);

  return (
    <AdminLayoutClient userEmail={userEmail} logoutAction={logoutAction} profile={displayProfile}>
      {children}
    </AdminLayoutClient>
  );
}
