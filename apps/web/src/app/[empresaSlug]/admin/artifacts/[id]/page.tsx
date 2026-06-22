import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import ArtifactClientView from "@/app/admin/artifacts/[id]/ArtifactClientView";
import { loadArtifactDetailPageData } from "@/lib/artifact-detail";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export const revalidate = 0;
export const dynamic = "force-dynamic";

export default async function TenantAdminArtifactDetailPage({
  params,
}: {
  params: Promise<{ empresaSlug: string; id: string }>;
}) {
  const { empresaSlug, id } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  const detail = await loadArtifactDetailPageData({
    artifactId: id,
    activeOrganizationId: tenant.organizationId,
    fallbackRole: "ADMIN",
    fallbackName: "Admin",
  });

  if (!detail) notFound();

  const basePath = `/${tenant.organizationSlug}/admin`;
  const { artifact, publicationRequest, publicationLessons, displayProfile } = detail;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-20">
      <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-[#94A3B8]">
        <Link href={`${basePath}/artifacts`} className="hover:text-gray-900 dark:hover:text-white flex items-center gap-1 transition-colors">
          <ArrowLeft size={16} />
          Volver a Artefactos
        </Link>
        <span className="text-gray-300 dark:text-[#6C757D]">/</span>
        <span className="text-gray-900 dark:text-white truncate max-w-xs">{artifact.idea_central}</span>
      </div>

      <ArtifactClientView
        artifact={artifact}
        publicationRequest={publicationRequest}
        publicationLessons={publicationLessons}
        profile={displayProfile}
        basePath={basePath}
      />
    </div>
  );
}
