import type { CompositionClip } from "./composition-document.types";
import type { CompositionPresetVariant } from "./composition-preset.types";

/** Solo propiedades portables; fuentes, palabras y referencias privadas son del destino. */
export function applyCompositionPresetAppearance(clip: CompositionClip, variant: CompositionPresetVariant) {
  if (variant.colorGrading !== undefined) {
    if (variant.colorGrading === null) delete clip.colorGrading;
    else clip.colorGrading = structuredClone(variant.colorGrading);
  }
  if (variant.fadeInRatio !== undefined) clip.fadeInSeconds = variant.fadeInRatio * clip.durationSeconds;
  if (variant.fadeOutRatio !== undefined) clip.fadeOutSeconds = variant.fadeOutRatio * clip.durationSeconds;
  if (variant.textStyle && (clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS")) {
    // La tipografía privada sigue vinculada y autorizada para el contenido destino.
    const fontAssetId = clip.source.style.fontAssetId;
    const fontFamily = clip.source.style.fontFamily;
    clip.source.style = { ...structuredClone(variant.textStyle), ...(fontAssetId ? { fontAssetId } : {}),
      ...(variant.preserveTargetFont || fontAssetId ? { fontFamily } : {}) };
  }
  if (clip.source.type === "NATIVE_CAPTIONS" && variant.captionEffects !== undefined) {
    if (variant.captionEffects === null) delete clip.source.effects;
    else clip.source.effects = structuredClone(variant.captionEffects);
  }
}
