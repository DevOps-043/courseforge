
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import LoginForm from './LoginForm';

export default async function LoginPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    // Verificar rol para redirigir correctamente
    const { data: profile } = await supabase
      .from('profiles')
      .select('platform_role')
      .eq('id', session.user.id)
      .single();

    if (profile?.platform_role === 'ADMIN' || profile?.platform_role === 'ARQUITECTO' || profile?.platform_role === 'CONSTRUCTOR') {
      redirect('/admin');
    }

    // Default fallback to admin
    redirect('/admin');
  }

  // Si no hay sesión, mostrar el formulario de login (Cliente)
  return <LoginForm />;
}
