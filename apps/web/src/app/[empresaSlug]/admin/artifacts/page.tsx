import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import ArtifactsList from "@/app/admin/artifacts/ArtifactsList";
import { loadArtifactsPageData } from "@/app/admin/artifacts/artifacts-page-data";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export default async function TenantAdminArtifactsPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  const basePath = `/${tenant.organizationSlug}/admin`;
  const { currentUserId, artifactsWithProfiles } = await loadArtifactsPageData({
    activeOrganizationId: tenant.organizationId,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[var(--engine-primary)] to-[var(--engine-surface-solid)] p-6 rounded-2xl border border-[var(--engine-info)]/20 relative overflow-hidden">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">Artefactos</h1>
          <p className="text-[var(--engine-text-muted)] text-sm">Gestiona los artefactos de esta empresa.</p>
        </div>
        <Link href={`${basePath}/artifacts/new`} className="relative z-10 bg-[var(--engine-info)] hover:bg-[var(--engine-info)] text-white px-5 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2 transition-all shadow-lg shadow-[var(--engine-info)]/20 group">
          <Plus size={18} className="group-hover:rotate-90 transition-transform" />
          Nuevo Artefacto
        </Link>
      </div>

      <ArtifactsList
        initialArtifacts={artifactsWithProfiles}
        currentUserId={currentUserId || undefined}
        basePath={basePath}
      />
    </div>
  );
}
