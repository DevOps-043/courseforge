import ArtifactsList from "@/app/admin/artifacts/ArtifactsList";
import { loadArtifactsPageData } from "@/app/admin/artifacts/artifacts-page-data";

export default async function ArchitectArtifactsPage() {
  const { currentUserId, artifactsWithProfiles } = await loadArtifactsPageData();

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#00D4B3]/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#00D4B3]/10 rounded-full blur-[60px] pointer-events-none translate-x-1/2 -translate-y-1/2" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">
            Control de Calidad
          </h1>
          <p className="text-[#94A3B8] text-sm">
            Gestiona y supervisa proyectos para asegurar su integridad
            instruccional.
          </p>
        </div>
      </div>

      <ArtifactsList
        initialArtifacts={artifactsWithProfiles}
        currentUserId={currentUserId || undefined}
        basePath="/architect"
      />
    </div>
  );
}
