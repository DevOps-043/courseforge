import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getActiveOrganizationId } from '@/utils/auth/session';
import { getAuthenticatedUser } from '@/lib/server/artifact-action-auth';
import ProfileForm from './ProfileForm';

export default async function ProfilePage({
  organizationId,
}: {
  organizationId?: string | null;
}) {
  const supabase = await createClient();

  const authUser = await getAuthenticatedUser(supabase);

  if (!authUser) {
    redirect('/login');
  }

  const activeOrgId = organizationId ?? (await getActiveOrganizationId());

  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, first_name, last_name_father, last_name_mother, username, platform_role')
    .eq('id', authUser.userId)
    .single();

  let artifactCountQuery = supabase
    .from('artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', authUser.userId);
  if (activeOrgId) artifactCountQuery = artifactCountQuery.eq('organization_id', activeOrgId);
  const { count: artifactCount } = await artifactCountQuery;

  return (
    <div className="w-full space-y-8">
      <div className="engine-page-hero flex items-center">
        <div>
          <p className="engine-eyebrow">Identidad y seguridad</p>
          <h1 className="mb-3">Mi perfil</h1>
          <p>Gestiona tu información personal y tus preferencias de cuenta.</p>
        </div>
      </div>
      
      <div>
         <ProfileForm 
           user={{
             id: authUser.userId,
             email: authUser.email || undefined,
             created_at: '',
           }} 
           profile={profile} 
           artifactCount={artifactCount || 0} 
         />
      </div>
    </div>
  );
}
