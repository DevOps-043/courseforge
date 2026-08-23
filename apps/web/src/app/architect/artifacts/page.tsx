import ArtifactsList from "@/app/admin/artifacts/ArtifactsList";
import { loadArtifactsPageData } from "@/app/admin/artifacts/artifacts-page-data";

export default async function ArchitectArtifactsPage() {
  const { currentUserId, artifactsWithProfiles } = await loadArtifactsPageData();

  return (
    <ArtifactsList
      initialArtifacts={artifactsWithProfiles}
      currentUserId={currentUserId || undefined}
      basePath="/architect"
    />
  );
}
