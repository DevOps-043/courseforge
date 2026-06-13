import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getActiveOrganizationId } from '@/utils/auth/session';
import ProfileForm from './ProfileForm';

export default async function ProfilePage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const activeOrgId = await getActiveOrganizationId();

  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, first_name, last_name_father, last_name_mother, username, platform_role')
    .eq('id', user.id)
    .single();

  const { data: cloudCreds } = await supabase
    .from('user_cloud_storage_credentials')
    .select('provider, account_email')
    .eq('user_id', user.id)
    .in('provider', ['google_drive', 'onedrive']);

  const googleCreds = cloudCreds?.find((cred) => cred.provider === 'google_drive');
  const oneDriveCreds = cloudCreds?.find((cred) => cred.provider === 'onedrive');
  const googleConnected = Boolean(googleCreds);
  const googleEmail = googleCreds?.account_email || null;
  const oneDriveConnected = Boolean(oneDriveCreds);
  const oneDriveEmail = oneDriveCreds?.account_email || null;

  let artifactCountQuery = supabase
    .from('artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', user.id);
  if (activeOrgId) artifactCountQuery = artifactCountQuery.eq('organization_id', activeOrgId);
  const { count: artifactCount } = await artifactCountQuery;

  return (
    <div className="w-full space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Mi Perfil</h1>
        <p className="text-[#94A3B8]">Gestiona tu información personal y preferencias de cuenta.</p>
      </div>
      
      <div>
         <ProfileForm 
           user={user} 
           profile={profile} 
           artifactCount={artifactCount || 0} 
           googleConnected={googleConnected}
           googleEmail={googleEmail}
           oneDriveConnected={oneDriveConnected}
           oneDriveEmail={oneDriveEmail}
         />
      </div>
    </div>
  );
}
