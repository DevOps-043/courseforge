import assert from "node:assert/strict";
import test from "node:test";
import { compositionVisualMaskSchema, compositionVisualMaskClipPath } from "../composition-visual-mask";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { compositionEditorPatchOperationSchema } from "../editor-patch.types";
import { createCompositionPreviewParentCommand } from "../composition-preview-protocol";
import { buildCompositionPreviewVisualPatch } from "../composition-preview-visual-patch";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { COMPOSITION_COMPILATION_TARGETS } from "../composition-compilation.types";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { createCompositionMaskPreviewRuntime } from "../composition-mask-preview-runtime";
import { extractCompositionPresetDefinition } from "../composition-preset-extraction.service";
import { applyCompositionPresetDefinition } from "../composition-preset-application.service";

export function maskFixture() {
  return createInitialCompositionDocument({
    animatedDeck: { css: ".slide{color:white}", fonts: [], height: 1080, width: 1920,
      slides: [{ animationCount: 0, classes: "slide", html: "<p>Diapositiva</p>", index: 0, label: "Ejemplo" }] },
    assets: [{ checksum: "a".repeat(64), durationSeconds: 8, fileSizeBytes: 4, hasAudio: false, mimeType: "video/mp4",
      productionAssetId: "00000000-0000-4000-8000-000000000041", publicUrl: null,
      storageBucket: "production-assets", storagePath: "fixture.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "", title: "Máscaras" },
  });
}

test("formas cerradas y límites no admiten CSS, URLs ni parámetros desconocidos", () => {
  for (const mask of [{ shape: "PATH", path: "url(https://example.com)" }, { shape: "CIRCLE", radius: 2 },
    { shape: "ROUNDED_RECT", radiusPercent: NaN }, { shape: "ROUNDED_RECT", radiusPercent: 51 }]) {
    assert.equal(compositionVisualMaskSchema.safeParse(mask).success, false);
    assert.throws(() => compositionVisualMaskClipPath(mask as never));
    assert.equal(createCompositionPreviewParentCommand({ type: "courseforge-composition-preview-mask", hfId: "clip", mask } as never), null);
  }
  assert.equal(compositionVisualMaskClipPath({ shape: "CIRCLE" }), "circle(closest-side at 50% 50%)");
  assert.equal(compositionVisualMaskClipPath({ shape: "ELLIPSE" }), "ellipse(50% 50% at 50% 50%)");
  assert.equal(compositionVisualMaskClipPath({ shape: "ROUNDED_RECT", radiusPercent: 25 }), "inset(0 round 25%)");
});

test("máscara persiste y se quita sin modificar crop, layout, motion ni fuente", () => {
  const initial = maskFixture(), clip = initial.clips.find(clip => clip.kind === "VIDEO")!;
  const cropped = applyCompositionEditorPatches(initial, [{ type: "clip.crop", clipId: clip.id, crop: { top: 10, right: 20, bottom: 30, left: 40 } }]);
  const operation = { type: "clip.mask" as const, clipId: clip.id, mask: { shape: "CIRCLE" as const } };
  assert.ok(compositionEditorPatchOperationSchema.safeParse(operation).success);
  const masked = applyCompositionEditorPatches(cropped, [operation]);
  const reloaded = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(masked)));
  const selected = reloaded.clips.find(item => item.id === clip.id)!;
  assert.deepEqual(selected.mask, { shape: "CIRCLE" });
  assert.deepEqual(selected.crop, cropped.clips.find(item => item.id === clip.id)!.crop);
  assert.deepEqual(selected.layout, clip.layout);
  assert.deepEqual(selected.source, clip.source);
  assert.deepEqual(masked.motion, initial.motion);
  assert.deepEqual(buildCompositionPreviewVisualPatch({ document: masked, operations: [operation] })?.changes, [{ hfId: clip.hfId, mask: { shape: "CIRCLE" } }]);
  const cleared = applyCompositionEditorPatches(masked, [{ type: "clip.mask", clipId: clip.id, mask: null }]);
  assert.deepEqual(cleared, cropped);
  const resized = applyCompositionEditorPatches(masked, [{ type: "clip.layout", clipId: clip.id, layout: { width: 500, height: 300 } }]);
  assert.deepEqual(resized.clips.find(item => item.id === clip.id)!.mask, selected.mask);
});

test("pista bloqueada y texto rechazan máscaras en servicio y documento", () => {
  const document = maskFixture(), clip = document.clips[0];
  document.tracks.find(track => track.id === clip.trackId)!.locked = true;
  assert.throws(() => applyCompositionEditorPatches(document, [{ type: "clip.mask", clipId: clip.id, mask: { shape: "ELLIPSE" } }]));
  const overlay = createCompositionNativeOverlay({ document: maskFixture(), id: "text-mask", kind: "TEXT", playheadSeconds: 0 });
  const withText = applyCompositionEditorPatches(maskFixture(), [{ type: "clip.add", clipId: overlay.clip.id, clip: overlay.clip, track: overlay.track }]);
  assert.throws(() => applyCompositionEditorPatches(withText, [{ type: "clip.mask", clipId: overlay.clip.id, mask: { shape: "ELLIPSE" } }]));
  withText.clips.find(clip => clip.id === overlay.clip.id)!.mask = { shape: "CIRCLE" };
  assert.equal(compositionEditorDocumentSchema.safeParse(withText).success, false);
});

test("renderer compartido intersecta máscara con crop en video y diapositiva; legacy no agrega wrapper", async () => {
  const initial = maskFixture();
  const urls = new Map([["00000000-0000-4000-8000-000000000041", "https://example.test/fixture.mp4"]]);
  const legacy = await compileCompositionPreview({ document: initial, documentHash: "a".repeat(64), assetUrls: urls });
  assert.doesNotMatch(legacy, /class="composition-visual-mask"/);
  let masked = initial;
  for (const clip of initial.clips) {
    masked = applyCompositionEditorPatches(masked, [{ type: "clip.crop", clipId: clip.id, crop: { top: 10, right: 20, bottom: 30, left: 40 } },
      { type: "clip.mask", clipId: clip.id, mask: { shape: "CIRCLE" } }]);
  }
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    const html = await compileCompositionPreview({ document: masked, documentHash: "a".repeat(64), assetUrls: urls, target });
    assert.match(html, /style="clip-path:inset\(10px 20px 30px 40px\);"><div class="composition-visual-mask"/);
    assert.match(html, /clip-path:circle\(closest-side at 50% 50%\)/);
  }
});

test("reiniciar un asset elimina máscara y recorte; audio rechaza la operación", () => {
  const initial = maskFixture(), clip = initial.clips.find(clip => clip.kind === "VIDEO")!;
  const masked = applyCompositionEditorPatches(initial, [{ type: "clip.mask", clipId: clip.id, mask: { shape: "CIRCLE" } },
    { type: "clip.crop", clipId: clip.id, crop: { top: 10, right: 10, bottom: 10, left: 10 } }]);
  const reset = applyCompositionEditorPatches(masked, [{ type: "clip.reset-asset", clipId: clip.id }]);
  assert.equal(reset.clips.find(item => item.id === clip.id)!.mask, undefined);
  assert.equal(reset.clips.find(item => item.id === clip.id)!.crop, undefined);
  const audio = createCompositionNativeOverlay({ document: initial, id: "audio-mask-test", kind: "TEXT", playheadSeconds: 0 });
  // Un clip de audio de fuente multimedia es válido sin campos de texto.
  const audioClip = { ...clip, id: "audio-mask", hfId: "audio-mask", kind: "AUDIO" as const, trackId: audio.track!.id };
  const withAudio = applyCompositionEditorPatches(initial, [{ type: "clip.add", clipId: audioClip.id, clip: audioClip, track: audio.track }]);
  assert.throws(() => applyCompositionEditorPatches(withAudio, [{ type: "clip.mask", clipId: audioClip.id, mask: { shape: "CIRCLE" } }]));
});

test("el preview conserva la máscara posterior y limpiar restaura el último canónico", () => {
  const target = { dataset: { visualMask: JSON.stringify({ shape: "CIRCLE" }) } } as unknown as HTMLElement;
  let visible = "";
  const runtime = createCompositionMaskPreviewRuntime(() => target,
    (_target, mask) => { visible = compositionVisualMaskClipPath(mask); }, compositionVisualMaskClipPath);
  runtime.preview("clip", { shape: "ROUNDED_RECT", radiusPercent: 35 });
  target.dataset.visualMask = JSON.stringify({ shape: "ROUNDED_RECT", radiusPercent: 20 });
  runtime.reapply();
  assert.equal(visible, "inset(0 round 35%)");
  runtime.preview("clip", null, true);
  assert.equal(visible, "inset(0 round 20%)");
  runtime.preview("clip", null);
  assert.equal(visible, "none");
  target.dataset.visualMask = "null";
  runtime.reapply();
  runtime.preview("clip", null, true);
  assert.equal(visible, "none");
});

test("las máscaras de imagen se renderizan y los presets las conservan", async () => {
  const initial = maskFixture(), clip = initial.clips.find(clip => clip.kind === "VIDEO")!;
  clip.kind = "IMAGE";
  const masked = applyCompositionEditorPatches(initial, [{ type: "clip.mask", clipId: clip.id,
    mask: { shape: "ROUNDED_RECT", radiusPercent: 25 } }]);
  const { definition } = extractCompositionPresetDefinition(masked);
  const applied = applyCompositionPresetDefinition({ document: initial, definition }).document;
  assert.deepEqual(applied.clips.find(item => item.id === clip.id)!.mask, { shape: "ROUNDED_RECT", radiusPercent: 25 });
  const html = await compileCompositionPreview({ document: masked, documentHash: "a".repeat(64),
    assetUrls: new Map([["00000000-0000-4000-8000-000000000041", "https://example.test/image.png"]]) });
  assert.match(html, /class="composition-visual-mask"[^>]*clip-path:inset\(0 round 25%\)/);
  assert.match(html, /<img[^>]*image.png/);
});
