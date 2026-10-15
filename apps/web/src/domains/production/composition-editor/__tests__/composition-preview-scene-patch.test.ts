import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { buildCompositionPreviewScenePatch, compositionPreviewScenePatchSchema } from "../composition-preview-scene-patch";
import { buildCompositionPreviewTimelineState } from "../composition-preview-timeline-state";
import { CompositionPreviewAssetUrlCache } from "../composition-preview-asset-urls.client";
import { createCompositionPreviewParentCommand } from "../composition-preview-protocol";
import { buildCompositionPreviewVisualPatch } from "../composition-preview-visual-patch";

const assetId = "00000000-0000-4000-8000-000000000041";
const replacementId = "00000000-0000-4000-8000-000000000042";
function fixture() {
  return createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "7".repeat(64), durationSeconds: 8, fileSizeBytes: 4, hasAudio: true, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, storageBucket: "production-assets", storagePath: "video.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "", title: "Live scene" },
  });
}

test("projects timing, opacity, track audio and fades with the canonical timeline", () => {
  const before = fixture();
  const clip = before.clips[0]!;
  const document = applyCompositionEditorPatches(before, [
    { type: "clip.trim", clipId: clip.id, startSeconds: 1, durationSeconds: 6, sourceOffsetSeconds: 1 },
    { type: "clip.layout", clipId: clip.id, layout: { opacity: 0.4 } },
    { type: "clip.volume", clipId: clip.id, volume: 1 },
    { type: "clip.audio-fades", clipId: clip.id, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 },
    { type: "track.update", trackId: clip.trackId, settings: { volume: 0.3 } },
  ]);
  const scene = buildCompositionPreviewScenePatch({ beforeDocument: before, document, assetUrls: new Map(), audioMetersEnabled: false });
  assert.ok(scene);
  assert.deepEqual(scene.timeline, buildCompositionPreviewTimelineState(document));
  assert.match(scene.nodes[0]!.html, /data-start="1" data-duration="6"/);
  assert.match(scene.nodes[0]!.html, /opacity:0.4/);
  assert.match(scene.nodes[0]!.html, /data-source-offset="1"/);
  assert.match(scene.nodes[0]!.html, /data-volume-automated="true"/);
  assert.equal(buildCompositionPreviewVisualPatch({ document, operations: [{ type: "clip.volume", clipId: clip.id, volume: 1 }] }), null, "Los fades deben reconstruir la envolvente al cambiar volumen.");
  assert.equal(createCompositionPreviewParentCommand({ baseDocumentHash: "a".repeat(64), patch: { changes: [], scene }, sequence: 1, type: "courseforge-composition-visual-patch" })?.type, "courseforge-composition-visual-patch");
});

test("renders native text and captions safely without injecting user markup", () => {
  const before = fixture();
  const overlay = createCompositionNativeOverlay({ document: before, id: "native-test", kind: "TEXT", playheadSeconds: 0 });
  const document = applyCompositionEditorPatches(before, [
    { type: "clip.add", clipId: overlay.clip.id, clip: overlay.clip, track: overlay.track },
    { type: "clip.text-content", clipId: overlay.clip.id, text: '<img src=x onerror="alert(1)"> <script>test</script>' },
  ]);
  const scene = buildCompositionPreviewScenePatch({ beforeDocument: before, document, assetUrls: new Map(), audioMetersEnabled: false });
  assert.ok(scene);
  const text = scene.nodes.find((node) => node.html.includes('id="native-test"'))!.html;
  assert.match(text, /&lt;script&gt;test&lt;\/script&gt;/);
  assert.doesNotMatch(text, /<script>|<img src=x/);
  assert.equal(scene.timeline.clips.find((clip) => clip.id === "native-test")?.kind, "TEXT");
});

test("falls back for new fonts or changed deck styles and rejects unsafe media URLs", () => {
  const before = fixture();
  assert.equal(buildCompositionPreviewScenePatch({ beforeDocument: before, document: { ...before, deckStyles: { css: "body{}", fontUrls: [] } }, assetUrls: new Map(), audioMetersEnabled: false }), null);
  const text = createCompositionNativeOverlay({ document: before, id: "new-font", kind: "TEXT", playheadSeconds: 0 });
  if (text.clip.source.type !== "NATIVE_TEXT") throw new Error("Invalid fixture");
  text.clip.source.style.fontAssetId = "00000000-0000-4000-8000-000000000099";
  const withFont = applyCompositionEditorPatches(before, [{ type: "clip.add", clipId: text.clip.id, clip: text.clip, track: text.track }]);
  assert.equal(buildCompositionPreviewScenePatch({ beforeDocument: before, document: withFont, assetUrls: new Map(), audioMetersEnabled: false }), null);
  const scene = buildCompositionPreviewScenePatch({ beforeDocument: before, document: before, assetUrls: new Map(), audioMetersEnabled: false })!;
  assert.equal(compositionPreviewScenePatchSchema.safeParse({ ...scene, assetUrls: { [assetId]: "javascript:alert(1)" } }).success, false);
  assert.equal(compositionPreviewScenePatchSchema.safeParse({ ...scene, assetUrls: { [assetId]: "/api/admin/users" } }).success, false);
  assert.equal(compositionPreviewScenePatchSchema.safeParse({ ...scene, assetUrls: { [assetId]: "https://storage.test/video.mp4" } }).success, true);
});

test("resolves only new assets via HEAD and reuses bounded signed URLs", async () => {
  const before = fixture();
  const document = applyCompositionEditorPatches(before, [{ type: "clip.replace-source", clipId: before.clips[0]!.id, mimeType: "video/mp4", productionAssetId: replacementId, sourceDurationSeconds: 8, hasAudio: true }]);
  const cache = new CompositionPreviewAssetUrlCache();
  let requests = 0;
  const params = { beforeDocument: before, document, assets: [{ id: replacementId, previewUrl: "/api/production/asset" }], fetcher: (async (_url, init) => {
    requests += 1;
    assert.equal(init?.method, "HEAD");
    return { ok: true, url: "https://storage.test/replacement.mp4?token=temporary" } as Response;
  }) as typeof fetch };
  assert.equal((await cache.resolveNewAssets({ ...params, document: before })).size, 0);
  assert.equal((await cache.resolveNewAssets(params)).get(replacementId), "https://storage.test/replacement.mp4?token=temporary");
  await cache.resolveNewAssets(params);
  assert.equal(requests, 1);
  await assert.rejects(new CompositionPreviewAssetUrlCache().resolveNewAssets({ ...params, fetcher: (async () => new Response(null, { status: 403 })) as typeof fetch }));
});
