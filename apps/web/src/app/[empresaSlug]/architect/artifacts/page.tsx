import { notFound } from "next/navigation";
import ArtifactsList from "@/app/admin/artifacts/ArtifactsList";
import { loadArtifactsPageData } from "@/app/admin/artifacts/artifacts-page-data";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export default async function TenantArchitectArtifactsPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  const basePath = `/${tenant.organizationSlug}/architect`;
  const { currentUserId, artifactsWithProfiles } = await loadArtifactsPageData({
    activeOrganizationId: tenant.organizationId,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-[var(--engine-primary)] to-[var(--engine-surface-solid)] p-6 rounded-2xl border border-[var(--engine-accent)]/20 relative overflow-hidden">
        <div className="relative z-10">
          <h1 className="text-2xl font-bold text-white mb-1">Control de Calidad</h1>
          <p className="text-[var(--engine-text-muted)] text-sm">Gestiona y supervisa proyectos de esta empresa.</p>
        </div>
      </div>

      <ArtifactsList
        initialArtifacts={artifactsWithProfiles}
        currentUserId={currentUserId || undefined}
        basePath={basePath}
      />
    </div>
  );
}
