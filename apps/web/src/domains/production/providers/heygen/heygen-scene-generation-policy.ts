import type { AvatarClip } from "@/domains/materials/types/materials.types";

export type HeygenSceneGenerationTarget = "avatar" | "voice_only";

export function sceneSupportsGenerationTarget(
  clip: Pick<AvatarClip, "expected_media_mode">,
  generationTarget: HeygenSceneGenerationTarget,
) {
  if (generationTarget === "avatar") {
    return clip.expected_media_mode === "avatar";
  }

  return clip.expected_media_mode === "voice_only"
    || clip.expected_media_mode === "avatar";
}

export function selectSceneIdsForGeneration<T extends Pick<AvatarClip, "deleted" | "expected_media_mode" | "id">>(
  clips: T[],
  generationTarget: HeygenSceneGenerationTarget,
) {
  return clips
    .filter((clip) => !clip.deleted && sceneSupportsGenerationTarget(clip, generationTarget))
    .map((clip) => clip.id);
}
