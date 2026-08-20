import { StandaloneAssemblyEditor } from "@/domains/production/standalone/StandaloneAssemblyEditor";

export const dynamic = "force-dynamic";

export default async function TenantStandaloneAssemblyEditorPage({
  params,
}: {
  params: Promise<{ empresaSlug: string; projectId: string }>;
}) {
  const { empresaSlug, projectId } = await params;
  return <StandaloneAssemblyEditor adminBasePath={`/${empresaSlug}/admin`} projectId={projectId} />;
}
