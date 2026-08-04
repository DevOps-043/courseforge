import { BundleAgentClient } from "./BundleAgentClient";

export default async function AdminRemotionBundleAgentPage({
  searchParams,
}: {
  searchParams?: Promise<{ artifactKind?: string; templateId?: string }>;
}) {
  const params = await searchParams;
  return (
    <BundleAgentClient
      initialArtifactKind={params?.artifactKind === "slide_template" ? "slide_template" : "video_bundle"}
      initialTemplateId={params?.templateId || null}
    />
  );
}
