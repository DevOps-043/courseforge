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

  // 2. Verificar Rol de Admin local de CourseForge
  let { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  // --- FALLBACK ROLE DETECTION ---
  // Si no pudimos leer el perfil con el cliente normal (puede pasar por RLS 
  // si el JWT aún no se propaga completamente), intentamos con el cliente admin.
  if (!profile) {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const cfAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: adminProfile } = await cfAdmin
      .from('profiles')
      .select('*')
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
  const displayProfile = profile || (bridgeUser ? {
    first_name: bridgeUser.first_name,
    last_name: bridgeUser.last_name,
    username: bridgeUser.username,
    avatar_url: bridgeUser.avatar_url,
    platform_role: bridgeUser.cargo_rol || 'CONSTRUCTOR',
  } : null);

  return (
    <AdminLayoutClient userEmail={userEmail} logoutAction={logoutAction} profile={displayProfile}>
      {children}
    </AdminLayoutClient>
  );
}
