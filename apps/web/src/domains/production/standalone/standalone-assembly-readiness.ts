import type { MaterialAssets } from "@/domains/materials/types/materials.types";

export interface StandaloneAssemblyReadiness {
  assetCount: number;
  canOpenEditor: boolean;
  durationSourceCount: number;
}

/**
 * Mirrors the editor's duration prerequisites without initializing a draft.
 * Background music and decorative images remain valid assets, but they cannot
 * define the length of a composition by themselves.
 */
export function getStandaloneAssemblyReadiness(
  assets: MaterialAssets | null | undefined,
): StandaloneAssemblyReadiness {
  const value = assets || {};
  const avatarClips = (value.avatar_clips || []).filter((clip) => !clip.deleted);
  const bRollClips = value.b_roll_clips || [];
  const animatedDeck = value.slides?.animated_deck;
  const deckIsReady = Boolean(
    animatedDeck
      && ["READY_FOR_PREVIEW", "READY_FOR_RENDER"].includes(animatedDeck.status)
      && animatedDeck.slides.length > 0,
  );

  const durationSourceCount = [
    positiveDuration(value.voice_audio?.duration),
    positiveDuration(value.avatar_video?.duration),
    ...avatarClips.map((clip) => positiveDuration(clip.duration)),
    ...bRollClips.map((clip) => positiveDuration(clip.duration)),
    deckIsReady,
  ].filter(Boolean).length;

  const assetCount = [
    Boolean(value.voice_audio),
    Boolean(value.background_music),
    Boolean(value.avatar_video),
    ...avatarClips.map(() => true),
    ...bRollClips.map(() => true),
    ...(value.slides?.images || []).map(() => true),
    deckIsReady,
  ].filter(Boolean).length;

  return {
    assetCount,
    canOpenEditor: durationSourceCount > 0,
    durationSourceCount,
  };
}

function positiveDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
