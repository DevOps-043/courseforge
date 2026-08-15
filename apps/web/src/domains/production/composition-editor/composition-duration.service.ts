import {
  COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS,
  type CompositionDurationSource,
} from "./composition-document.types";

export interface CompositionDurationAsset {
  durationSeconds?: number;
  timelineRole?: "AUDIO" | "AVATAR" | "BROLL" | "VISUAL" | "VOICE";
  timelineVariant?: "CLIP" | "FULL";
}

export interface CompositionDurationResolution {
  durationSeconds: number;
  source: CompositionDurationSource;
}

export class CompositionDurationResolutionError extends Error {
  constructor(
    message: string,
    readonly code: "DURATION_EXCEEDS_LIMIT" | "NO_ELIGIBLE_DURATION_SOURCE",
  ) {
    super(message);
  }
}

/**
 * Resolves one authoritative duration without allowing unrelated media or the
 * generated plan to influence it. Only measured media durations are eligible.
 */
export function resolveCompositionDuration(input: {
  assets: CompositionDurationAsset[];
  slideCount: number;
}): CompositionDurationResolution {
  const voiceDuration = sumMeasuredDurations(input.assets.filter((asset) => asset.timelineRole === "VOICE"));
  if (voiceDuration > 0) return assertSupportedDuration(voiceDuration, "voice");

  const fullAvatars = input.assets.filter((asset) => (
    asset.timelineRole === "AVATAR" && asset.timelineVariant === "FULL"
  ));
  const fullAvatarDuration = maxMeasuredDuration(fullAvatars);
  if (fullAvatarDuration > 0) return assertSupportedDuration(fullAvatarDuration, "avatar_full");

  const avatarClips = input.assets.filter((asset) => (
    asset.timelineRole === "AVATAR" && asset.timelineVariant !== "FULL"
  ));
  const avatarClipsDuration = sumMeasuredDurations(avatarClips);
  if (avatarClipsDuration > 0) return assertSupportedDuration(avatarClipsDuration, "avatar_clips");

  const bRollDuration = sumMeasuredDurations(input.assets.filter((asset) => asset.timelineRole === "BROLL"));
  if (bRollDuration > 0) return assertSupportedDuration(bRollDuration, "b_roll");

  if (Number.isInteger(input.slideCount) && input.slideCount > 0) {
    return assertSupportedDuration(input.slideCount * 5, "slides");
  }

  throw new CompositionDurationResolutionError(
    "No se pudo calcular la duración. Agrega una voz, un avatar, B-roll con duración válida o un deck con diapositivas.",
    "NO_ELIGIBLE_DURATION_SOURCE",
  );
}

function measuredDuration(asset: CompositionDurationAsset) {
  return typeof asset.durationSeconds === "number"
    && Number.isFinite(asset.durationSeconds)
    && asset.durationSeconds > 0
    ? asset.durationSeconds
    : 0;
}

function sumMeasuredDurations(assets: CompositionDurationAsset[]) {
  return roundSeconds(assets.reduce((total, asset) => total + measuredDuration(asset), 0));
}

function maxMeasuredDuration(assets: CompositionDurationAsset[]) {
  return roundSeconds(assets.reduce((longest, asset) => Math.max(longest, measuredDuration(asset)), 0));
}

function assertSupportedDuration(
  durationSeconds: number,
  source: CompositionDurationSource,
): CompositionDurationResolution {
  if (durationSeconds > COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS) {
    throw new CompositionDurationResolutionError(
      `La duración calculada (${roundSeconds(durationSeconds)} s) supera el máximo permitido de ${COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS} s.`,
      "DURATION_EXCEEDS_LIMIT",
    );
  }
  return { durationSeconds: roundSeconds(durationSeconds), source };
}

function roundSeconds(value: number) {
  return Math.round(value * 1000) / 1000;
}
