import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import ProfileForm from './ProfileForm';

export default async function ProfilePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const { count: artifactCount } = await supabase
    .from('artifacts')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', user.id);

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Mi Perfil</h1>
        <p className="text-[#94A3B8]">Gestiona tu información personal y preferencias de cuenta.</p>
      </div>
      
      <div>
         <ProfileForm user={user} profile={profile} artifactCount={artifactCount || 0} />
      </div>
    </div>
  );
}
