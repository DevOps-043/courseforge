import { notFound } from "next/navigation";
import NewArtifactPage from "@/app/admin/artifacts/new/page";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export default async function TenantBuilderNewArtifactPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  return <NewArtifactPage basePath={`/${tenant.organizationSlug}/builder`} />;
}
