import { getActiveOrganizationId } from "@/utils/auth/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ArtifactClientView from "./ArtifactClientView";
import { loadArtifactDetailPageData } from "@/lib/artifact-detail";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function ArtifactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const activeOrgId = await getActiveOrganizationId();
  const detail = await loadArtifactDetailPageData({
    artifactId: id,
    activeOrganizationId: activeOrgId,
    fallbackRole: "ADMIN",
    fallbackName: "Admin",
  });

  if (!detail) {
    notFound();
  }

  const { artifact, publicationRequest, publicationLessons, displayProfile } =
    detail;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-[#94A3B8]">
        <Link
          href="/admin/artifacts"
          className="hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors"
        >
          <ArrowLeft size={16} />
          Volver a Artefactos
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
      />
    </div>
  );
}
