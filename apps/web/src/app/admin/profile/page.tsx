import { redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getActiveOrganizationId } from '@/utils/auth/session';
import { getAuthenticatedUser } from '@/lib/server/artifact-action-auth';
import ProfileForm from './ProfileForm';
import { getSofliaMemberSinceDate } from './profile-member-since.server';
import { resolveMemberSinceDate } from './profile-member-since';

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

  let artifactCountQuery = supabase
    .from('artifacts')
    .select('id', { count: 'exact', head: true })
    .eq('created_by', authUser.userId);
  if (activeOrgId) artifactCountQuery = artifactCountQuery.eq('organization_id', activeOrgId);

  const [{ data: profile }, { count: artifactCount }, sofliaCreatedAt] = await Promise.all([
    supabase
      .from('profiles')
      .select('avatar_url, first_name, last_name_father, last_name_mother, username, platform_role, created_at')
      .eq('id', authUser.userId)
      .single(),
    artifactCountQuery,
    getSofliaMemberSinceDate(authUser.userId),
  ]);

  const memberSince = resolveMemberSinceDate({
    sofliaCreatedAt,
    localCreatedAt: profile?.created_at,
  });

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
             created_at: memberSince,
           }} 
           profile={profile} 
           artifactCount={artifactCount || 0} 
         />
      </div>
    </div>
  );
}
