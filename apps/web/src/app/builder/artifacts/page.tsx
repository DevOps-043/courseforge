import { redirect } from "next/navigation";
import ArtifactsList from "@/app/admin/artifacts/ArtifactsList";
import { loadArtifactsPageData } from "@/app/admin/artifacts/artifacts-page-data";

export default async function ConstructorArtifactsPage() {
  const { currentUserId, artifactsWithProfiles } = await loadArtifactsPageData({
    onlyCurrentUser: true,
  });

  if (!currentUserId) {
    redirect("/login");
  }

  return (
    <ArtifactsList
      initialArtifacts={artifactsWithProfiles}
      currentUserId={currentUserId}
      basePath="/builder"
    />
  );
}
