import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { logoutAction } from '../login/actions';
import AdminLayoutClient from './AdminLayoutClient';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // 1. Verificar Sesión
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  // 2. Verificar Rol de Admin
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profileError || profile?.platform_role !== 'ADMIN') {
    // Si no es admin, redirigir al dashboard de usuario normal
    redirect('/dashboard?error=unauthorized');
  }

  return (
    <AdminLayoutClient userEmail={user.email} logoutAction={logoutAction} profile={profile}>
      {children}
    </AdminLayoutClient>
  );
}
