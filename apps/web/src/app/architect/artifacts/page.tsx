import { createClient } from '@/utils/supabase/server';
import { getActiveOrganizationId, getAuthBridgeUser } from '@/utils/auth/session';
import ArtifactsList from '@/app/admin/artifacts/ArtifactsList';

export default async function ArchitectArtifactsPage() {
  const supabase = await createClient();
  const activeOrgId = await getActiveOrganizationId();

  // 1. Fetch Artifacts filtered by organization
  let query = supabase
    .from('artifacts')
    .select('*, syllabus(state), instructional_plans(state)')
    .order('created_at', { ascending: false });

  if (activeOrgId) {
    query = query.eq('organization_id', activeOrgId);
  }

  const { data: artifacts } = await query;

  // 2. Fetch Profiles related to these artifacts
  const userIds = artifacts ? [...new Set(artifacts.map((a: any) => a.created_by))] : [];
  let profiles: any[] = [];

  if (userIds.length > 0) {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, email')
      .in('id', userIds);
    profiles = data || [];
  }

  // 3. Fetch production status for each artifact
  const artifactIds = artifacts?.map((a: any) => a.id) || [];
  let productionStatusMap: Record<string, { total: number; completed: number }> = {};

  if (artifactIds.length > 0) {
    const { data: materials } = await supabase
      .from('materials')
      .select(`
        artifact_id,
        material_lessons (
          material_components (
            type,
            assets
          )
        )
      `)
      .in('artifact_id', artifactIds);

    materials?.forEach((m: any) => {
      const artifactId = m.artifact_id;
      if (!productionStatusMap[artifactId]) {
        productionStatusMap[artifactId] = { total: 0, completed: 0 };
      }

      m.material_lessons?.forEach((lesson: any) => {
        lesson.material_components?.forEach((comp: any) => {
          if (comp.type?.includes('VIDEO')) {
            productionStatusMap[artifactId].total++;
            if (comp.assets?.final_video_url) {
              productionStatusMap[artifactId].completed++;
            }
          }
        });
      });
    });
  }

  // 4. Get current user
  const { data: { user } } = await supabase.auth.getUser();
  const bridgeUser = !user ? await getAuthBridgeUser() : null;
  const currentUserId = user?.id || bridgeUser?.id;

  // 5. Merge all data
  const artifactsWithProfiles = artifacts?.map((art: any) => {
    const syllabus = Array.isArray(art.syllabus) ? art.syllabus[0] : art.syllabus;
    const instructional_plan = Array.isArray(art.instructional_plans) ? art.instructional_plans[0] : art.instructional_plans;

    const prodStatus = productionStatusMap[art.id];
    const isProductionComplete = prodStatus && prodStatus.total > 0 && prodStatus.completed === prodStatus.total;

    return {
      ...art,
      syllabus_state: syllabus?.state,
      plan_state: instructional_plan?.state,
      production_status: prodStatus || { total: 0, completed: 0 },
      production_complete: isProductionComplete,
      profiles: profiles.find((p: any) => p.id === art.created_by)
    };
  }) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#00D4B3]/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#00D4B3]/10 rounded-full blur-[60px] pointer-events-none translate-x-1/2 -translate-y-1/2" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Control de Calidad</h1>
          <p className="text-[#94A3B8] text-sm">Gestiona y supervisa proyectos para asegurar su integridad instruccional.</p>
        </div>
      </div>

      {/* Client List Component - Reused from Admin */}
      <ArtifactsList initialArtifacts={artifactsWithProfiles} currentUserId={currentUserId} />
    </div>
  );
}
