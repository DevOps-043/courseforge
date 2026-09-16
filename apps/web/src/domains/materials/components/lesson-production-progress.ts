import type { MaterialAssets, MaterialComponent } from "../types/materials.types";

export interface LessonProductionProgress {
  completed: number;
  inProgress: number;
  percentage: number;
  total: number;
}

function hasVoice(assets: MaterialAssets) {
  return Boolean(
    assets.voice_audio ||
      assets.manual_voice_clips?.length ||
      assets.voice_clips?.length ||
      assets.avatar_video?.has_audio,
  );
}

function hasRenderableSlides(assets: MaterialAssets) {
  return Boolean(
    assets.slides_url ||
      assets.slides?.html_public_url ||
      assets.slides?.animated_deck?.status === "READY_FOR_PREVIEW" ||
      assets.slides?.animated_deck?.status === "READY_FOR_RENDER",
  );
}

/**
 * Production reserves the first half for source assets and the second half for
 * the assembled final video. Screencasts are intentionally excluded.
 */
export function getComponentProductionPercentage(component: MaterialComponent) {
  const assets = component.assets || {};
  if (assets.final_video_url) return 100;

  const assetChecks: boolean[] = [];
  const isVideo = component.type.includes("VIDEO");
  const needsSlides =
    component.type === "VIDEO_THEORETICAL" ||
    component.type === "VIDEO_GUIDE" ||
    component.type === "VIDEO_DEMO";

  if (isVideo) {
    assetChecks.push(
      hasVoice(assets),
      Boolean(assets.background_music),
      Boolean(assets.avatar_video),
      Boolean(assets.b_roll_clips?.length),
    );
  }

  if (needsSlides) assetChecks.push(hasRenderableSlides(assets));
  if (isVideo) assetChecks.push(Boolean(assets.b_roll_prompts));

  if (assetChecks.length === 0) return 0;

  const completedAssets = assetChecks.filter(Boolean).length;
  return Math.round((completedAssets / assetChecks.length) * 50);
}

export function getProductionProgress(
  components: MaterialComponent[],
): LessonProductionProgress {
  const total = components.length;
  const componentPercentages = components.map(getComponentProductionPercentage);
  const completed = componentPercentages.filter((percentage) => percentage === 100).length;
  const inProgress = componentPercentages.filter(
    (percentage) => percentage > 0 && percentage < 100,
  ).length;
  const percentage = total === 0
    ? 0
    : Math.round(
        componentPercentages.reduce((sum, value) => sum + value, 0) / total,
      );

  return { completed, inProgress, percentage, total };
}

export function getLessonProductionProgress(
  components: MaterialComponent[],
): LessonProductionProgress {
  return getProductionProgress(components);
}
