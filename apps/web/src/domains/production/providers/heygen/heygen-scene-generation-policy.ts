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

/**
 * Splits a mixed scene list into the two billable operations required by
 * HeyGen. Avatar scenes already generate their own separated voice, so the
 * voice-only batch must not include them a second time.
 */
export function buildSceneGenerateAllPlan<
  T extends Pick<AvatarClip, "deleted" | "expected_media_mode" | "id">,
>(clips: T[], selectedClipIds?: readonly string[]) {
  const selectedIds = selectedClipIds ? new Set(selectedClipIds) : null;
  const selectedClips = selectedIds
    ? clips.filter((clip) => selectedIds.has(clip.id))
    : clips;

  return {
    avatarClipIds: selectSceneIdsForGeneration(selectedClips, "avatar"),
    voiceOnlyClipIds: selectedClips
      .filter((clip) => !clip.deleted && clip.expected_media_mode === "voice_only")
      .map((clip) => clip.id),
  };
}
