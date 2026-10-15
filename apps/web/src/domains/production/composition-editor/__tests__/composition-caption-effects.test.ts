import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { gsap } from "gsap";
import { createCaptionEffectsFixture } from "./composition-caption-effects.fixtures";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { compositionCaptionCueSchema } from "../composition-text-layer.types";
import { DEFAULT_CAPTION_EFFECTS, compositionCaptionEffectsSchema } from "../composition-caption-effects.types";
import { buildCaptionEffectPlan, buildCaptionTextParts, captionEffectElementId, captionPartElementId } from "../composition-caption-effects-plan";
import { scheduleCaptionEffects } from "../composition-caption-effects-runtime";
import { captionSelectionTokens, resolveCaptionEffects, retainCaptionCueWordWindow } from "../composition-caption-effects.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildTextParityCheckpointPlan } from "../composition-text-checkpoint-plan";
import { NATIVE_TEXT_GEOMETRY_POLICY } from "../composition-text-parity-contract";
import { createCaptionEffectsProjection } from "../composition-caption-effects-projection";
import { compositionEditorPatchRequestSchema } from "../editor-patch.types";

function caption(document = createCaptionEffectsFixture()) {
  const clip = document.clips[0]!;
  if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected captions");
  return { document, clip, source: clip.source };
}

test("strict versioned settings reject executable values, unknown fields, unbounded values and versions", () => {
  for (const value of [{ ...DEFAULT_CAPTION_EFFECTS, version: 2 }, { ...DEFAULT_CAPTION_EFFECTS, intensity: Infinity },
    { ...DEFAULT_CAPTION_EFFECTS, durationSeconds: 9 }, { ...DEFAULT_CAPTION_EFFECTS, activeColor: "url(javascript:alert(1))" },
    { ...DEFAULT_CAPTION_EFFECTS, selector: "body" }]) assert.equal(compositionCaptionEffectsSchema.safeParse(value).success, false);
});

test("emphasis uses exact occurrences, Unicode-safe offsets and non-overlapping ranges", () => {
  const text = "sí sí 👋 中文";
  assert.deepEqual(captionSelectionTokens(text).map((token) => text.slice(token.start, token.end)), ["sí", "sí", "👋", "中文"]);
  const cue = { id: "cue", text, startSeconds: 0, endSeconds: 2 };
  const spaced = compositionCaptionCueSchema.parse({ ...cue, text: "  Hola  ", emphasis: [{ start: 2, end: 6, color: "#ff0000" }] });
  assert.equal(spaced.text, "  Hola  ");
  assert.ok(compositionCaptionCueSchema.safeParse({ ...cue, emphasis: [{ start: 3, end: 5, color: "#ff0000" }] }).success);
  for (const emphasis of [[{ start: 6, end: 7, color: "#ff0000" }], [{ start: 0, end: 99, color: "#ff0000" }],
    [{ start: 0, end: 4, color: "#ff0000" }, { start: 3, end: 5, color: "#ff0000" }]]) {
    assert.equal(compositionCaptionCueSchema.safeParse({ ...cue, emphasis }).success, false);
  }
  assert.equal(compositionCaptionCueSchema.safeParse({ ...cue, text: "a\u0301", emphasis: [{ start: 0, end: 1, color: "#ff0000" }] }).success, false);
});

test("cue overrides inherit untouched settings and unconfigured documents keep the old runtime", async () => {
  const { document, source } = caption();
  assert.equal(resolveCaptionEffects(source.cues[1]!, source.effects).entry, "POP");
  assert.equal(resolveCaptionEffects(source.cues[1]!, source.effects).exit, "FADE");
  delete source.effects;
  source.cues.forEach((cue) => { delete cue.effects; delete cue.emphasis; });
  assert.deepEqual(buildCaptionEffectPlan(document), []);
  const html = await compileCompositionPreview({ document, assetUrls: new Map() });
  assert.match(html, /class="composition-caption-word" style="opacity:0.55;"/);
  assert.doesNotMatch(html, /id="captions-caption-first-effect"/);
});

test("text parts preserve punctuation, spaces, emoji and authored text even without acoustic alignment", () => {
  const { source } = caption();
  const cue = source.cues[0]!;
  assert.equal(buildCaptionTextParts(cue).map((part) => part.text).join(""), cue.text);
  assert.ok(buildCaptionTextParts(cue).some((part) => part.text === "mundo" && part.emphasis?.color === "#00ff00" && part.word?.id === "mundo"));
  const unaligned = { ...cue, words: [{ ...cue.words![0]!, text: "missing" }] };
  assert.ok(buildCaptionTextParts(unaligned).every((part) => !part.word));
  assert.equal(buildCaptionTextParts(unaligned).map((part) => part.text).join(""), cue.text);
});

test("entry/exit durations fit even a one-frame cue and zero cues produce no targets", () => {
  const { document, source } = caption();
  source.cues = [{ id: "short", text: "Breve", startSeconds: 0, endSeconds: 1 / document.canvas.fps }];
  const phases = buildCaptionEffectPlan(document).filter((step) => step.duration > 0);
  assert.equal(phases.length, 2);
  assert.ok(phases[0]!.at + phases[0]!.duration <= phases[1]!.at);
  source.cues = [];
  assert.deepEqual(buildCaptionEffectPlan(document), []);
});

test("runtime targets stay bounded at document validation, independently of general motion limits", () => {
  const { document, source } = caption();
  const tokens = Array.from({ length: 100 }, () => "a").join(" ");
  source.cues = Array.from({ length: 100 }, (_, index) => ({ id: `cue-${index}`, text: tokens, startSeconds: index * 0.05, endSeconds: (index + 1) * 0.05,
    emphasis: Array.from({ length: 100 }, (_, token) => ({ start: token * 2, end: token * 2 + 1, color: "#ff0000" })) }));
  assert.equal(compositionEditorDocumentSchema.safeParse(document).success, false);
});

test("the embedded scheduler exactly matches server scheduling and fails closed for missing nodes", () => {
  const steps = buildCaptionEffectPlan(createCaptionEffectsFixture());
  const rows: unknown[] = [], embedded: unknown[] = [];
  const adapter = (out: unknown[]) => ({
    set(target: string, values: object, at: number) { out.push([target, values, at]); },
    fromTo(target: string, from: object, to: object, at: number) { out.push([target, from, to, at]); },
  });
  scheduleCaptionEffects(adapter(rows), steps, (id) => id);
  runInNewContext(`(${scheduleCaptionEffects.toString()})(timeline, steps, resolveTarget)`, { timeline: adapter(embedded), steps, resolveTarget: (id: string) => id });
  assert.equal(JSON.stringify(rows), JSON.stringify(embedded));
  assert.throws(() => scheduleCaptionEffects(adapter(rows), steps, () => null), /TARGET_NOT_FOUND/);
});

test("GSAP effects reproduce color, opacity and pulse after reverse seeks and restore emphasized colors", () => {
  const document = createCaptionEffectsFixture();
  const projection = createCaptionEffectsProjection(document);
  try {
    // Locate by authored range instead of relying on a word spelling search in the runtime.
    const { source } = caption(document);
    const index = buildCaptionTextParts(source.cues[0]!).findIndex((part) => part.text === "mundo");
    const id = captionPartElementId("captions", "first", index);
    for (const seconds of [1.9, 2.9, 1.9]) {
      const states = projection.at(seconds, captionEffectElementId("captions", "first"));
      const state = states.find((pose) => pose.elementId === id)!;
      assert.equal(state.color, seconds === 2.9 ? "rgba(0,255,0,1)" : "rgba(250,204,21,1)");
      assert.equal(state.opacity, seconds === 2.9 ? 0.55 : 1);
      if (seconds === 1.9) assert.ok(state.scale > 1);
    }
  } finally { projection.dispose(); }
});

test("effects survive splits, trims, movement, duration extension and independent style edits", () => {
  const { document, source } = caption();
  const split = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: "captions", atSeconds: 2, newClipId: "right", newHfId: "right" }]);
  const right = split.clips.find((clip) => clip.id === "right")!;
  assert.ok(right.source.type === "NATIVE_CAPTIONS");
  assert.deepEqual(right.source.effects, source.effects);
  assert.equal(right.source.cues[0]!.words![0]!.id, "mundo");
  assert.deepEqual(right.source.cues[0]!.emphasis, source.cues[0]!.emphasis);
  const moved = applyCompositionEditorPatches(split, [{ type: "clip.move", clipId: "right", startSeconds: 3 }]);
  const movedPlan = buildCaptionEffectPlan(moved);
  assert.ok(movedPlan.some((step) => step.targetId === captionEffectElementId("right", "first") && step.at === 3 && step.duration > 0));
  const trimmed = applyCompositionEditorPatches(document, [{ type: "clip.trim", clipId: "captions", startSeconds: 2, durationSeconds: 2, sourceOffsetSeconds: 1 }]);
  const retained = caption(trimmed).source;
  assert.equal(retained.cues[0]!.startSeconds, 0);
  assert.equal(retained.cues.at(-1)!.endSeconds, 2);
  assert.deepEqual(retained.effects, source.effects);
  const extended = applyCompositionEditorPatches(document, [{ type: "clip.duration", clipId: "captions", durationSeconds: 6 }]);
  assert.deepEqual(caption(extended).source.cues, source.cues);
  const leftExtended = applyCompositionEditorPatches(document, [{ type: "clip.trim", clipId: "captions", startSeconds: 0, durationSeconds: 6, sourceOffsetSeconds: 0 }]);
  assert.equal(caption(leftExtended).source.cues[0]!.startSeconds, 1);
  assert.equal(caption(leftExtended).source.cues[0]!.words![0]!.startSeconds, 1.2);
});

test("wording edits atomically invalidate word timestamps and emphasis but preserve phrase effects", () => {
  const { document, source } = caption();
  const updated = applyCompositionEditorPatches(document, [{ type: "clip.caption-cues", clipId: "captions", cues: source.cues.map((cue, index) => index ? cue : { ...cue, text: "Otro texto" }) }]);
  assert.equal(caption(updated).source.cues[0]!.words, undefined);
  assert.equal(caption(updated).source.cues[0]!.emphasis, undefined);
  assert.deepEqual(caption(updated).source.effects, source.effects);
  assert.ok(source.cues[0]!.words);
});

test("manual phrase timing edits clip acoustic words without stretching or regenerating them", () => {
  const { source } = caption();
  const cue = retainCaptionCueWordWindow({ ...source.cues[0]!, startSeconds: 0.5, endSeconds: 1.1 });
  assert.ok(compositionCaptionCueSchema.safeParse(cue).success);
  assert.deepEqual(cue.words!.map((word) => [word.startSeconds, word.endSeconds]), [[0.5, 0.8], [0.8, 1.1]]);
  assert.equal(cue.text, source.cues[0]!.text);
  assert.deepEqual(cue.emphasis, source.cues[0]!.emphasis);
});

test("persisted effects restore with the document and interval removals preserve surviving overrides", () => {
  const { document, source } = caption();
  const removed = applyCompositionEditorPatches(document, [{ type: "clip.remove-range", clipId: "captions", startSeconds: 1.5, endSeconds: 2.5, ripple: false, newClipId: "right", newHfId: "right" }]);
  assert.ok(compositionEditorDocumentSchema.safeParse(removed).success);
  const right = removed.clips.find((clip) => clip.id === "right")!;
  assert.ok(right.source.type === "NATIVE_CAPTIONS");
  assert.deepEqual(right.source.effects, source.effects);
  assert.deepEqual(right.source.cues.find((cue) => cue.id === "second")!.effects, source.cues[1]!.effects);
  const restored = applyCompositionEditorPatches(removed, [{ type: "document.restore", document }]);
  assert.deepEqual(caption(restored).source, source);
});

test("effect mutations respect track locking, explicit user intent and the authoring flag", () => {
  const { document } = caption();
  const operation = { type: "clip.caption-effects" as const, clipId: "captions", effects: { ...DEFAULT_CAPTION_EFFECTS, entry: "FADE" as const } };
  assert.throws(() => applyCompositionEditorPatches(document, [operation], "AGENT"), /usuario/);
  document.tracks.find((track) => track.id === "native-captions")!.locked = true;
  assert.throws(() => applyCompositionEditorPatches(document, [operation]), /bloqueada/);
  document.tracks.find((track) => track.id === "native-captions")!.locked = false;
  const previous = process.env.NEXT_PUBLIC_CAPTION_EFFECTS_ENABLED;
  try {
    process.env.NEXT_PUBLIC_CAPTION_EFFECTS_ENABLED = "false";
    assert.throws(() => applyCompositionEditorPatches(document, [operation]), /desactivada/);
    assert.ok(compositionEditorDocumentSchema.safeParse(document).success);
    assert.ok(buildCaptionEffectPlan(document).length);
    assert.equal(caption(applyCompositionEditorPatches(document, [{ ...operation, effects: null }])).source.effects, undefined);
    const { source } = caption(document);
    source.cues[0]!.effects = { entry: "FADE" };
    const cue = { ...source.cues[0]!, text: "Texto editado" };
    delete cue.words;
    delete cue.emphasis;
    const textEdited = applyCompositionEditorPatches(document, [{ type: "clip.caption-cues", clipId: "captions", cues: [cue] }]);
    assert.equal(caption(textEdited).source.cues[0]!.text, "Texto editado");
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_CAPTION_EFFECTS_ENABLED; else process.env.NEXT_PUBLIC_CAPTION_EFFECTS_ENABLED = previous; }
  assert.ok(compositionEditorPatchRequestSchema.safeParse({ source: "USER", summary: "Configura captions", operations: [operation] }).success);
});

test("preview and export share effects and frozen QA expectations cover color, opacity and transforms", async () => {
  const document = createCaptionEffectsFixture();
  const preview = await compileCompositionPreview({ document, assetUrls: new Map() });
  const render = await compileCompositionPreview({ document, assetUrls: new Map(), target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
  for (const html of [preview, render]) {
    assert.match(html, /id="captions-caption-first-effect"/);
    assert.match(html, /scheduleCaptionEffects/);
    assert.match(html, /rgba\(250,204,21,1\)/);
  }
  const plan = buildTextParityCheckpointPlan(document, 1.9, NATIVE_TEXT_GEOMETRY_POLICY);
  const pose = plan.expectedTexts[0]!.presentation!;
  assert.ok(pose.captionEffects!.some((state) => state.color === "rgba(250,204,21,1)" && state.scale > 1));
  assert.ok(pose.paintPose);
  assert.equal(buildTextParityCheckpointPlan(document, 1, NATIVE_TEXT_GEOMETRY_POLICY).expectedTexts[0]!.visibility, "HIDDEN");
});

test("forward and backward phrase seeking reproduces the same exact GSAP state", () => {
  const steps = buildCaptionEffectPlan(createCaptionEffectsFixture());
  const targets = new Map(steps.map((step) => [step.targetId, { opacity: 1, y: 0, scale: 1, color: "", backgroundColor: "" }]));
  const timeline = gsap.timeline({ paused: true });
  try {
    scheduleCaptionEffects(timeline, steps, (id) => targets.get(id));
    timeline.time(1.125);
    const first = { ...targets.get(captionEffectElementId("captions", "first"))! };
    timeline.time(4.9); timeline.time(1.125);
    const repeated = targets.get(captionEffectElementId("captions", "first"))!;
    assert.equal(first.opacity, repeated.opacity);
    assert.equal(first.y, repeated.y);
    assert.ok(first.opacity > 0 && first.opacity < 1);
  } finally { timeline.kill(); }
});
