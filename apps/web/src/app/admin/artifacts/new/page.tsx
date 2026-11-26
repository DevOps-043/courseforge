import { ArtifactCreationForm } from "@/domains/artifacts/components/ArtifactCreationForm";
import { deliveryEnabled } from "@/domains/course-delivery/config/delivery-enabled";

export default function NewArtifactPage({ basePath = "/admin" }: { basePath?: string }) {
  return <ArtifactCreationForm basePath={basePath} sessionsEnabled={deliveryEnabled()} />;
}
