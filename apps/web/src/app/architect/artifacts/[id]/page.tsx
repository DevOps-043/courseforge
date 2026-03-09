import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import ArtifactClientView from '@/app/admin/artifacts/[id]/ArtifactClientView';
import { getAuthBridgeUser } from '@/utils/auth/session';

export default async function ArchitectArtifactPage({ params }: { params: { id: string } }) {
  const { id } = params;

  // UUID Validation
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
      return (
          <div className="p-8 pb-32 max-w-7xl mx-auto">
              <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl shadow-sm text-center">
                  <h2 className="text-lg font-semibold mb-2">ID de Artefacto Inválido</h2>
                  <p>El identificador proporcionado no tiene un formato válido.</p>
              </div>
          </div>
      );
  }

  const supabase = await createClient();

  // Obtener Sesión/Perfil para pasarle a ArtifactClientView su role context
  // Esto es crucial para que Architect siga teniendo botones de QA
  let { data: { user } } = await supabase.auth.getUser();
  let bridgeUser = null;
  if (!user) {
    bridgeUser = await getAuthBridgeUser();
  }
  const userId = user?.id || bridgeUser?.id;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  const displayProfile = profile || (bridgeUser ? {
      first_name: bridgeUser.first_name,
      platform_role: 'ARQUITECTO' 
  } : null);

  const { data: artifact, error } = await supabase
    .from('artifacts')
    .select(`
      *,
      syllabus(*),
      instructional_plans(*)
    `)
    .eq('id', id)
    .single();

  if (error || !artifact) {
    redirect('/architect/artifacts');
  }

  // Supabase returns 1:N relations as arrays
  const syllabus = Array.isArray(artifact.syllabus) ? artifact.syllabus[0] : artifact.syllabus;
  const instructional_plan = Array.isArray(artifact.instructional_plans) ? artifact.instructional_plans[0] : artifact.instructional_plans;

  // Flatten the artifact object
  const flattenedArtifact = {
      ...artifact,
      syllabus,
      instructional_plan
  };

  return <ArtifactClientView 
    initialArtifact={flattenedArtifact} 
    sourceId={artifact.source_id} 
    profile={displayProfile}
  />;
}
