
import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import ArtifactClientView from './ArtifactClientView';

export default async function ArtifactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  
  // Fetch Artifact
  // Fetch Artifact con Syllabus relacionado
  const { data: artifactRaw, error } = await supabase
    .from('artifacts')
    .select('*, syllabus(*)')
    .eq('id', id)
    .single();

  if (error || !artifactRaw) {
    notFound();
  }

  // Aplanar estructura para el cliente
  // Supabase devuelve relaciones 1:N como array por defecto si no detecta 1:1 estricto
  const syllabusData = Array.isArray(artifactRaw.syllabus) ? artifactRaw.syllabus[0] : artifactRaw.syllabus;
  
  const artifact = {
    ...artifactRaw,
    // Inyectamos el registro de syllabus como 'temario' para que el cliente lo consuma
    temario: syllabusData || null,
    // Helpers directos de estado
    syllabus_state: syllabusData?.state,
    syllabus_status: syllabusData?.state // Alias por si acaso
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      
      {/* Top Navigation */}
      <div className="flex items-center gap-4 text-sm text-[#94A3B8]">
        <Link href="/admin/artifacts" className="hover:text-white flex items-center gap-1 transition-colors">
            <ArrowLeft size={16} />
            Volver a Artefactos
        </Link>
        <span className="text-[#6C757D]">/</span>
        <span className="text-white truncate max-w-xs">{artifact.idea_central}</span>
      </div>

      {/* Interactive Client View */}
      <ArtifactClientView artifact={artifact} />

    </div>
  );
}
