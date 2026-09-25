import type { CompositionClip } from "./composition-document.types";

export function compositionClipExclusionKey(clip: CompositionClip) {
  if (clip.source.type === "DECK_SLIDE") {
    if (clip.source.htmlAssetId) return `html:${clip.source.htmlAssetId}:${clip.source.sourceSlideIndex}`;
    return clip.sceneId ? `clip:${clip.id}` : `deck:${clip.source.slideKey || clip.source.slideIndex}`;
  }
  if (clip.source.type === "PRODUCTION_ASSET") return `asset:${clip.source.productionAssetId}`;
  if (clip.source.type === "SOUND_EFFECT_ASSET") return `sfx:${clip.source.soundEffectAssetId}`;
  if (clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS") return `native:${clip.id}`;
  return `brand:${clip.source.assemblyBrandAssetId}`;
}

export function isCompositionClipExcluded(clip: CompositionClip, excludedSources: string[] = []) {
  return excludedSources.includes(compositionClipExclusionKey(clip))
    || (clip.source.type === "DECK_SLIDE" && !clip.source.htmlAssetId && !clip.sceneId && excludedSources.includes(`deck:${clip.source.slideIndex}`));
}
