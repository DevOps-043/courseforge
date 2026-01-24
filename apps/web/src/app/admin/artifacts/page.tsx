import { createClient } from '@/utils/supabase/server';
import ArtifactsList from './ArtifactsList';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export default async function ArtifactsPage() {
  const supabase = await createClient();

  // 1. Fetch Artifacts with syllabus and plan states
  const { data: artifacts } = await supabase
    .from('artifacts')
    .select('*, syllabus(state), instructional_plans(state)')
    .order('created_at', { ascending: false });

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
  // Get materials -> lessons -> components with VIDEO type
  const artifactIds = artifacts?.map((a: any) => a.id) || [];
  let productionStatusMap: Record<string, { total: number; completed: number }> = {};

  if (artifactIds.length > 0) {
    // Get all materials and their components in one query
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

    // Process to calculate completion status
    materials?.forEach((m: any) => {
      const artifactId = m.artifact_id;
      if (!productionStatusMap[artifactId]) {
        productionStatusMap[artifactId] = { total: 0, completed: 0 };
      }

      m.material_lessons?.forEach((lesson: any) => {
        lesson.material_components?.forEach((comp: any) => {
          // Only count VIDEO components
          if (comp.type?.includes('VIDEO')) {
            productionStatusMap[artifactId].total++;
            // Check if has final_video_url (production complete)
            if (comp.assets?.final_video_url) {
              productionStatusMap[artifactId].completed++;
            }
          }
        });
      });
    });
  }

  // 4. Get current user for ownership filter
  const { data: { user } } = await supabase.auth.getUser();
  const currentUserId = user?.id;

  // 5. Merge all data
  const artifactsWithProfiles = artifacts?.map((art: any) => {
    // Supabase returns 1:N relations as arrays
    const syllabus = Array.isArray(art.syllabus) ? art.syllabus[0] : art.syllabus;
    const instructional_plan = Array.isArray(art.instructional_plans) ? art.instructional_plans[0] : art.instructional_plans;

    const prodStatus = productionStatusMap[art.id];
    const isProductionComplete = prodStatus && prodStatus.total > 0 && prodStatus.completed === prodStatus.total;

    return {
      ...art,
      // Sub-step states (from main branch)
      syllabus_state: syllabus?.state,
      plan_state: instructional_plan?.state,
      // Production status (from HEAD branch)
      production_status: prodStatus || { total: 0, completed: 0 },
      production_complete: isProductionComplete,
      // Profile info
      profiles: profiles.find((p: any) => p.id === art.created_by)
    };
  }) || [];

  return (
    <div className="space-y-6">
      {/* Featured Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#1F5AF6]/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#1F5AF6]/10 rounded-full blur-[60px] pointer-events-none translate-x-1/2 -translate-y-1/2" />

        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Artefactos</h1>
          <p className="text-[#94A3B8] text-sm">Gestiona y supervisa todos los artefactos generados por los usuarios.</p>
        </div>
        <Link href="/admin/artifacts/new" className="relative z-10 bg-[#1F5AF6] hover:bg-[#1a4bd6] text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[#1F5AF6]/20 group">
          <Plus size={18} className="group-hover:rotate-90 transition-transform" />
          Nuevo Artefacto
        </Link>
      </div>

      {/* Client List Component */}
      <ArtifactsList initialArtifacts={artifactsWithProfiles} currentUserId={currentUserId} />
    </div>
  )
}
