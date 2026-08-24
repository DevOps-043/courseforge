import ArtifactsList from "./ArtifactsList";
import { loadArtifactsPageData } from "./artifacts-page-data";

export default async function ArtifactsPage() {
  const { currentUserId, artifactsWithProfiles } = await loadArtifactsPageData();

  return (
    <ArtifactsList
      initialArtifacts={artifactsWithProfiles}
      currentUserId={currentUserId || undefined}
      basePath="/admin"
    />
  );
}
