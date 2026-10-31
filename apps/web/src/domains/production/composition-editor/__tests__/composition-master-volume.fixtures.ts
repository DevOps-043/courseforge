import { createInitialCompositionDocument } from "../composition-document.factory";

export const MASTER_VOLUME_ASSET_IDS = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
] as const;

export function createMasterVolumeFixture() {
  const document = createInitialCompositionDocument({ animatedDeck: null,
    assets: MASTER_VOLUME_ASSET_IDS.map((productionAssetId, index) => ({ productionAssetId,
      checksum: "a".repeat(64), fileSizeBytes: 100, durationSeconds: 4, publicUrl: null,
      mimeType: index === 2 ? "video/mp4" : "audio/wav", hasAudio: true,
      storageBucket: "production-assets", storagePath: `source-${index}`,
      timelineRole: index === 0 ? "VOICE" as const : index === 1 ? "AUDIO" as const : "AVATAR" as const,
    })), plan: { title: "Maestro", subtitle: "", durationSeconds: 4, accentColor: "#38BDF8" } });
  document.audioMix.ducking.enabled = false;
  for (const clip of document.clips) clip.volume = 0.8;
  for (const track of document.tracks) track.volume = 0.5;
  return document;
}
