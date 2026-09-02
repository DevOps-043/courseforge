import type { CompositionClip } from "./composition-document.types";

export function compositionClipExclusionKey(clip: CompositionClip) {
  if (clip.source.type === "DECK_SLIDE") {
    return clip.sceneId ? `clip:${clip.id}` : `deck:${clip.source.slideKey || clip.source.slideIndex}`;
  }
  if (clip.source.type === "PRODUCTION_ASSET") return `asset:${clip.source.productionAssetId}`;
  return `brand:${clip.source.assemblyBrandAssetId}`;
}

export function isCompositionClipExcluded(clip: CompositionClip, excludedSources: string[] = []) {
  return excludedSources.includes(compositionClipExclusionKey(clip))
    || (clip.source.type === "DECK_SLIDE" && !clip.sceneId && excludedSources.includes(`deck:${clip.source.slideIndex}`));
}
