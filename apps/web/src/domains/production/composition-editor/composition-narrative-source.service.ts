import { createHash } from "node:crypto";
import type { AvatarClip, MaterialAssets } from "../../materials/types/materials.types";
import type { HyperframesAnimatedDeckSource } from "../hyperframes/hyperframes.types";
import { sceneVisualPlanSchema, type CompositionNarrativeScene, type SceneVisualCatalog } from "./composition-narrative.types";

export function narrativeFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Content identity survives slide reordering; a regenerated slide needs review. */
export function compositionSlideKey(slide: { html: string; classes: string }) {
  return narrativeFingerprint(JSON.stringify([slide.html, slide.classes]));
}

export function buildSceneVisualCatalog(deck: HyperframesAnimatedDeckSource | null): SceneVisualCatalog | null {
  if (!deck) return null;
  const slides = deck.slides.map((slide) => ({
    key: compositionSlideKey(slide), index: slide.index, label: slide.label,
    text: slide.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000),
  }));
  return { deckRevision: narrativeFingerprint(JSON.stringify(slides.map((slide) => slide.key))), slides };
}

/** Carries authored narration to the editor without generating or purchasing media. */
export function buildCompositionNarrativeScenes(assets: MaterialAssets, catalog: SceneVisualCatalog | null): CompositionNarrativeScene[] {
  if (assets.avatar_generation_mode !== "scene_clips") return [];
  return (assets.avatar_clips || []).filter((scene) => !scene.deleted && scene.expected_media_mode !== "none")
    .sort((a, b) => a.order - b.order).map((scene) => {
      const scriptHash = narrativeFingerprint(scene.script_text);
      const voice = assets.voice_clips?.find((candidate) => candidate.clip_id === scene.id && candidate.status === "COMPLETED");
      const parsedPlan = sceneVisualPlanSchema.safeParse(scene.visual_plan);
      const visualPlan = parsedPlan.success ? parsedPlan.data : undefined;
      return {
        id: scene.id, order: scene.order, label: scene.asset_name || `Escena ${scene.order}`,
        scriptText: scene.script_text, scriptHash, visualPlan,
        needsReview: !visualPlan || visualPlan.scriptHash !== scriptHash
          || visualPlan.deckRevision !== catalog?.deckRevision
          || visualPlan.slides.some((slide) => !catalog?.slides.some((option) => option.key === slide.key))
          || scene.status === "STALE" || scene.voice_status === "STALE"
          || Boolean(voice && voice.script_hash !== scriptHash),
        wordTimestamps: voice?.script_hash === scriptHash ? voice.word_timestamps : undefined,
      };
    });
}

/** Rejects unknown references in a current deck; old approvals remain visibly stale. */
export function validateSceneVisualPlans(clips: AvatarClip[], catalog: SceneVisualCatalog | null) {
  return clips.map((clip) => {
    if (!clip.visual_plan) return clip;
    const plan = sceneVisualPlanSchema.parse(clip.visual_plan);
    if (catalog && plan.deckRevision === catalog.deckRevision
      && plan.slides.some((slide) => !catalog.slides.some((option) => option.key === slide.key))) {
      throw new Error("La presentación cambió. Actualiza las escenas y revisa sus slides antes de guardar.");
    }
    // The server owns the approval fingerprint so a client cannot associate a
    // visual plan with narration other than the script saved in this request.
    return {
      ...clip,
      visual_plan: { ...plan, scriptHash: narrativeFingerprint(clip.script_text) },
    };
  });
}
