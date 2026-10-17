import assert from "node:assert/strict";
import test from "node:test";
import { applyCaptionAnimationPreset, identifyCaptionAnimationPreset, listCaptionAnimationPresets, CAPTION_ANIMATION_PRESET_IDS } from "../composition-caption-animation-presets";
import { CAPTION_EFFECT_COLORS, DEFAULT_CAPTION_EFFECTS, compositionCaptionEffectsSchema } from "../composition-caption-effects.types";
import { createCaptionEffectsFixture } from "./composition-caption-effects.fixtures";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { createCaptionEffectsProjection } from "../composition-caption-effects-projection";
import { buildCaptionEffectPlan, buildCaptionTextParts, captionEffectElementId, captionPartElementId } from "../composition-caption-effects-plan";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";

test("los tres presets son válidos, reconocibles y no comparten objetos mutables", () => {
  assert.deepEqual(listCaptionAnimationPresets().map(preset => preset.label), ["Educativo", "Lectura guiada", "Social"]);
  for (const id of CAPTION_ANIMATION_PRESET_IDS) {
    const effects = applyCaptionAnimationPreset(id);
    assert.equal(identifyCaptionAnimationPreset(effects), id);
    assert.equal(effects.pulse, false);
    assert.equal(effects.inactiveOpacity, 1);
    effects.durationSeconds = 1.99;
    assert.notEqual(applyCaptionAnimationPreset(id).durationSeconds, 1.99);
    assert.equal(identifyCaptionAnimationPreset(effects), null);
  }
  assert.equal(identifyCaptionAnimationPreset(undefined), null);
  assert.equal(identifyCaptionAnimationPreset(DEFAULT_CAPTION_EFFECTS), null);
});

test("los documentos anteriores conservan su forma y los colores nuevos se validan estrictamente", () => {
  assert.deepEqual(compositionCaptionEffectsSchema.parse(DEFAULT_CAPTION_EFFECTS), DEFAULT_CAPTION_EFFECTS);
  assert.equal("activeBackgroundColor" in compositionCaptionEffectsSchema.parse(DEFAULT_CAPTION_EFFECTS), false);
  const social = applyCaptionAnimationPreset("SOCIAL");
  for (const invalid of ["url(javascript:alert(1))", "red;position:fixed", "#fff", "rgba(0,0,0,1)"]) {
    assert.equal(compositionCaptionEffectsSchema.safeParse({ ...social, activeBackgroundColor: invalid }).success, false);
  }
  assert.equal(compositionCaptionEffectsSchema.safeParse({ ...social, callback: "alert(1)" }).success, false);
});

test("el preset persiste por el patch autorizado sin modificar texto, estilo, tiempos ni overrides", () => {
  const original = createCaptionEffectsFixture();
  const before = structuredClone(original.clips[0]!);
  for (const id of CAPTION_ANIMATION_PRESET_IDS) {
    const updated = applyCompositionEditorPatches(original, [{ type: "clip.caption-effects", clipId: before.id, effects: applyCaptionAnimationPreset(id) }]);
    const clip = updated.clips[0]!;
    assert.ok(clip.source.type === "NATIVE_CAPTIONS" && before.source.type === "NATIVE_CAPTIONS");
    assert.deepEqual(clip.source.cues, before.source.cues);
    assert.deepEqual(clip.source.style, before.source.style);
    assert.equal(clip.startSeconds, before.startSeconds);
    assert.equal(clip.durationSeconds, before.durationSeconds);
    assert.deepEqual(clip.layout, before.layout);
    assert.equal(identifyCaptionAnimationPreset(clip.source.effects), id);
  }
  assert.deepEqual(original.clips[0], before);
});

test("Social resalta solo la palabra activa y restaura el énfasis al retroceder y avanzar", () => {
  const document = createCaptionEffectsFixture();
  const source = document.clips[0]!.source;
  assert.ok(source.type === "NATIVE_CAPTIONS");
  source.effects = applyCaptionAnimationPreset("SOCIAL");
  const partIndex = buildCaptionTextParts(source.cues[0]!).findIndex(part => part.text === "mundo");
  const wordId = captionPartElementId("captions", "first", partIndex);
  const projection = createCaptionEffectsProjection(document);
  try {
    const active = projection.at(1.9, captionEffectElementId("captions", "first"));
    const selected = active.find(pose => pose.elementId === wordId)!;
    assert.equal(selected.color, "rgba(15,23,42,1)");
    assert.equal(selected.backgroundColor, "rgba(250,204,21,1)");
    assert.equal(selected.opacity, 1);
    for (const pose of active) { assert.equal(pose.x, 0); assert.equal(pose.y, 0); assert.equal(pose.scale, 1); }
    const inactive = projection.at(2.9, captionEffectElementId("captions", "first")).find(pose => pose.elementId === wordId)!;
    assert.equal(inactive.color, "rgba(0,255,0,1)");
    assert.equal(inactive.backgroundColor, "rgba(0,0,128,1)");
    assert.deepEqual(projection.at(1.9, captionEffectElementId("captions", "first")), active);
  } finally { projection.dispose(); }
});

test("el fondo opcional tiene fallback y un texto sin alineación conserva la frase sin resaltar palabras falsas", () => {
  const document = createCaptionEffectsFixture();
  const source = document.clips[0]!.source;
  assert.ok(source.type === "NATIVE_CAPTIONS");
  source.effects = applyCaptionAnimationPreset("SOCIAL");
  delete source.effects.activeBackgroundColor;
  assert.ok(buildCaptionEffectPlan(document).some(step => step.to.backgroundColor === "rgba(250,204,21,1)"));
  source.cues[0]!.words = [{ id: "unaligned", text: "Texto distinto", startSeconds: 0, endSeconds: 1 }];
  assert.equal(buildCaptionTextParts(source.cues[0]!).map(part => part.text).join(""), source.cues[0]!.text);
  const firstCueSteps = buildCaptionEffectPlan(document).filter(step => step.targetId.startsWith("captions-caption-first-part-"));
  assert.ok(firstCueSteps.every(step => step.to.color !== "rgba(15,23,42,1)"));
  assert.equal(CAPTION_EFFECT_COLORS.highlightBackground, "#facc15");
});

test("preview y render comparten el HTML del resaltado sin padding que desplace palabras", async () => {
  const document = createCaptionEffectsFixture();
  const source = document.clips[0]!.source;
  assert.ok(source.type === "NATIVE_CAPTIONS"); source.effects = applyCaptionAnimationPreset("SOCIAL");
  const html = await Promise.all([COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]
    .map(target => compileCompositionPreview({ document, target, assetUrls: new Map() })));
  const words = html.map(markup => markup.match(/<span id="captions-caption-first-part-[^>]+>[^<]*<\/span>/g));
  assert.ok(words[0]?.length); assert.deepEqual(words[0], words[1]);
  assert.ok(words[0]!.some(word => word.includes("border-radius:4px")));
  assert.ok(words[0]!.every(word => !word.includes("padding:")));
});
