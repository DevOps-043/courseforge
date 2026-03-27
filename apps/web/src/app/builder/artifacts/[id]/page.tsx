import { redirect } from "next/navigation";
import ArtifactClientView from "@/app/admin/artifacts/[id]/ArtifactClientView";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { loadArtifactDetailPageData } from "@/lib/artifact-detail";

export default async function ConstructorArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return (
      <div className="p-8 pb-32 max-w-7xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl shadow-sm text-center">
          <h2 className="text-lg font-semibold mb-2">
            ID de Artefacto Inválido
          </h2>
          <p>El identificador proporcionado no tiene un formato válido.</p>
        </div>
      </div>
    );
  }

  const detail = await loadArtifactDetailPageData({
    artifactId: id,
    fallbackRole: "CONSTRUCTOR",
    fallbackName: "Constructor",
  });

  if (!detail) {
    redirect("/builder/artifacts");
  }

  const { artifact, publicationRequest, publicationLessons, displayProfile } =
    detail;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-[#94A3B8]">
        <Link
          href="/builder/artifacts"
          className="hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Volver a Mis Asignaciones
        </Link>
        <span className="text-gray-300 dark:text-[#6C757D]">/</span>
        <span className="text-gray-900 dark:text-white truncate max-w-xs">
          {artifact.idea_central}
        </span>
      </div>

      <ArtifactClientView
        artifact={artifact}
        publicationRequest={publicationRequest}
        publicationLessons={publicationLessons}
        profile={displayProfile}
        basePath="/builder"
      />
    </div>
  );
}
