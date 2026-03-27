import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import ArtifactsList from "@/app/admin/artifacts/ArtifactsList";
import { loadArtifactsPageData } from "@/app/admin/artifacts/artifacts-page-data";

export default async function ConstructorArtifactsPage() {
  const { currentUserId, artifactsWithProfiles } = await loadArtifactsPageData({
    onlyCurrentUser: true,
  });

  if (!currentUserId) {
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[#0A2540] to-[#151A21] p-6 rounded-2xl border border-[#1F5AF6]/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#1F5AF6]/10 rounded-full blur-[60px] pointer-events-none translate-x-1/2 -translate-y-1/2" />
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Mis Asignaciones</h1>
          <p className="text-[#94A3B8] text-sm">
            Estos son los proyectos en los que estás trabajando actualmente.
          </p>
        </div>
        <Link
          href="/builder/artifacts/new"
          className="relative z-10 bg-[#1F5AF6] hover:bg-[#1a4bd6] text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[#1F5AF6]/20 group"
        >
          <Plus size={18} className="group-hover:rotate-90 transition-transform" />
          Nuevo Artefacto
        </Link>
      </div>

      <ArtifactsList
        initialArtifacts={artifactsWithProfiles}
        currentUserId={currentUserId}
        basePath="/builder"
      />
    </div>
  );
}
