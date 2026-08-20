import { StandaloneAssemblyEditor } from "@/domains/production/standalone/StandaloneAssemblyEditor";

export const dynamic = "force-dynamic";

export default async function StandaloneAssemblyEditorPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <StandaloneAssemblyEditor adminBasePath="/admin" projectId={projectId} />;
}
