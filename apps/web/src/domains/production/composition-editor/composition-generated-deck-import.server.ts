import type { CompositionEditorDocument } from "./composition-document.types";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import type { HyperframesAnimatedDeckSource } from "../hyperframes/hyperframes.types";
import { GeneratedDeckReadError, type VerifiedGeneratedDeck } from "../slides/generation/course-deck-editorial-reader.server";
import { buildSceneVisualCatalog } from "./composition-narrative-source.service";
import type { CompositionNarrativeScene } from "./composition-narrative.types";
import { generatedDeckFontBindingsMatch } from "../slides/generation/course-deck-editorial-fonts.server";

/** Rebind only plans approved for the exact current owned presentation. Index
 * alone is not evidence that a regenerated or external slide is equivalent. */
export function generatedDeckInitialNarrativeScenes(scenes: CompositionNarrativeScene[] | undefined, verified: VerifiedGeneratedDeck) {
  if (!scenes?.length) return scenes;
  const presentation = buildSceneVisualCatalog(verified.presentationSource())!;
  const editorial = buildSceneVisualCatalog(generatedDeckInitialSource(verified))!;
  const replacements = new Map(presentation.slides.map(slide => [slide.key,
    editorial.slides.find(candidate => candidate.index === slide.index)]));
  return scenes.map(scene => {
    const plan = scene.visualPlan;
    if (scene.needsReview || !plan || plan.scriptHash !== scene.scriptHash || plan.deckRevision !== presentation.deckRevision
      || plan.slides.some(slide => !replacements.get(slide.key))) return { ...scene, needsReview: true };
    return { ...scene, visualPlan: { ...plan, deckRevision: editorial.deckRevision,
      slides: plan.slides.map(slide => ({ ...slide, key: replacements.get(slide.key)!.key })) } };
  });
}

/** Only for a not-yet-persisted initial document. There is deliberately no
 * reconcile/replace operation here: authored sources and revisions stay intact. */
export function generatedDeckInitialSource(verified: VerifiedGeneratedDeck): HyperframesAnimatedDeckSource {
  if (!generatedDeckFontBindingsMatch(verified.artifact.fontRequirements, verified.fontBindings)) throw new GeneratedDeckReadError("FONT_BINDING_REQUIRED");
  return { appearance: verified.artifact.appearance, width: verified.artifact.width, height: verified.artifact.height,
    css: "", fonts: [], slides: verified.artifact.fragments.map(fragment => ({ index: fragment.index,
      classes: fragment.classes, label: fragment.label, html: fragment.html, animationCount: 0 })) };
}

export function instantiateGeneratedDeckDocument(document: CompositionEditorDocument, verified: VerifiedGeneratedDeck) {
  generatedDeckInitialSource(verified);
  if (document.htmlEditing?.items.length) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
  const clips = document.clips.map(clip => {
    if (clip.source.type !== "DECK_SLIDE" || clip.source.htmlAssetId) return clip;
    const source = clip.source;
    const base = verified.artifact.fragments.find(fragment => fragment.index === source.slideIndex);
    if (!base || base.html !== clip.source.html) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
    const instance = verified.instance(clip.id, clip.source.slideIndex);
    return { ...clip, source: { ...clip.source, html: instance.html, classes: instance.classes,
      ...(verified.fontBindings?.length ? { fontBindings: verified.fontBindings } : {}) } };
  });
  // CSS is immutable and self-contained per fragment. No unbound global sheet
  // or remote font URLs can block the first coordinated field save.
  return compositionEditorDocumentSchema.parse({ ...document, clips, deckStyles: null });
}
