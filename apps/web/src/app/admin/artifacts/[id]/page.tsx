
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ArtifactClientView from './ArtifactClientView';

export default async function ArtifactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch Artifact
  // Fetch Artifact con Syllabus e Instructional Plans relacionados
  const { data: artifactRaw, error } = await supabase
    .from('artifacts')
    .select('*, syllabus(*), instructional_plans(*)')
    .eq('id', id)
    .single();

  if (error || !artifactRaw) {
    notFound();
  }

  // Fetch Curation separadamente (relación puede no estar configurada)
  const { data: curationRaw } = await supabase
    .from('curation')
    .select('*')
    .eq('artifact_id', id)
    .maybeSingle();

  // Fetch Materials separadamente (la tabla puede no existir aún)
  let materialsRaw = null;
  try {
    const { data } = await supabase
      .from('materials')
      .select('*')
      .eq('artifact_id', id)
      .maybeSingle();
    materialsRaw = data;
  } catch {
    // Tabla materials puede no existir aún
    console.log('Materials table not found or query failed');
  }

  // Aplanar estructura para el cliente
  // Supabase devuelve relaciones 1:N como array por defecto si no detecta 1:1 estricto
  const syllabusData = Array.isArray(artifactRaw.syllabus) ? artifactRaw.syllabus[0] : artifactRaw.syllabus;
  const instructionalPlanData = Array.isArray(artifactRaw.instructional_plans) ? artifactRaw.instructional_plans[0] : artifactRaw.instructional_plans;
  const curationData = curationRaw || null;
  const materialsData = materialsRaw || null;

  const artifact = {
    ...artifactRaw,
    // Inyectamos el registro de syllabus como 'temario' para que el cliente lo consuma
    temario: syllabusData || null,
    instructional_plan: instructionalPlanData || null,
    curation: curationData,
    materials: materialsData,
    // Helpers directos de estado
    syllabus_state: syllabusData?.state,
    syllabus_status: syllabusData?.state, // Alias por si acaso
    plan_state: instructionalPlanData?.state,
    curation_state: curationData?.state,
    materials_state: materialsData?.state
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">

      {/* Top Navigation */}
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-[#94A3B8]">
        <Link href="/admin/artifacts" className="hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors">
          <ArrowLeft size={16} />
          Volver a Artefactos
        </Link>
        <span className="text-gray-300 dark:text-[#6C757D]">/</span>
        <span className="text-gray-900 dark:text-white truncate max-w-xs">{artifact.idea_central}</span>
      </div>

      {/* Interactive Client View */}
      <ArtifactClientView artifact={artifact} />

    </div>
  );
}
