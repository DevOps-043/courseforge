import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument, reconcileCompositionDocument } from "../composition-document.factory";
import { normalizeCompositionTrackTopology } from "../composition-track-registry";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { compositionEditorPatchRequestSchema } from "../editor-patch.types";
import { resolveCompositionCanvasFormat } from "../composition-canvas-format";
import { buildCompositionTimelineLayout } from "../composition-timeline-layout.service";
import { inspectStandaloneMedia } from "../../standalone/standalone-media.service";

function documentWithMedia(mimeTypes = ["image/png", "video/mp4", "audio/mpeg"]) {
  return createInitialCompositionDocument({ animatedDeck: null,
    assets: mimeTypes.map((mimeType, index) => ({
      mimeType, timelineRole: "MEDIA" as const, checksum: "a".repeat(64), fileSizeBytes: 100,
      productionAssetId: `00000000-0000-4000-8000-00000000000${index + 1}`,
      publicUrl: null, storageBucket: "production-assets", storagePath: `production-assets/test-${index}`,
      durationSeconds: index ? 10 : undefined, hasAudio: index > 0,
    })), plan: { title: "Test", subtitle: "", durationSeconds: 20, accentColor: "#000000" } });
}

test("generic media uses format tracks without avatar or music defaults", () => {
  const document = documentWithMedia();
  assert.deepEqual(document.tracks.map((track) => track.label), ["PNG", "MP4", "MP3"]);
  assert.ok(document.tracks.every((track) => !track.semanticRole && track.volume === 1));
  assert.equal(document.canvas.durationSource, "media");
  assert.ok(document.clips.filter((clip) => clip.kind !== "AUDIO").every((clip) => clip.mediaFit === "CONTAIN"));
  const groups = buildCompositionTimelineLayout(document).groups.filter((group) => group.kind === "VISUAL");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].zIndex, groups[1].zIndex);
});

test("renamed format tracks survive normalization and vertical edits preserve geometry", () => {
  const document = documentWithMedia();
  const patch = compositionEditorPatchRequestSchema.parse({ source: "USER", summary: "Editar formato y nombre",
    operations: [{ type: "track.update", trackId: "media-mp4", settings: { label: "Producto" } },
      { type: "composition.canvas-size", width: 1080, height: 1920 }] });
  const edited = applyCompositionEditorPatches(document, patch.operations);
  const reopened = normalizeCompositionTrackTopology(edited, new Map());
  assert.equal(reopened.tracks.find((track) => track.id === "media-mp4")?.label, "Producto");
  assert.equal(resolveCompositionCanvasFormat(reopened.canvas), "9:16");
  assert.deepEqual(edited.clips, document.clips);
  assert.equal(document.canvas.width, 1920);
});

test("images alone initialize with an editable duration", () => {
  const document = documentWithMedia(["image/png"]);
  assert.equal(document.canvas.durationSeconds, 5);
  const image = document.clips[0];
  assert.equal(image.durationSeconds, 5);
  assert.equal(compositionEditorPatchRequestSchema.safeParse({ summary: "Nombre vacío", operations: [
    { type: "track.update", trackId: "media-png", settings: { label: " " } },
  ] }).success, false);
  assert.throws(() => resolveCompositionCanvasFormat({ width: 1234, height: 567 }));
});

test("server probes actual image content and rejects a forged format", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
  const metadata = await inspectStandaloneMedia(png, "image/png");
  assert.equal(metadata.width, 1);
  await assert.rejects(inspectStandaloneMedia(png, "image/jpeg"));
  await assert.rejects(inspectStandaloneMedia(new Uint8Array([1, 2, 3]), "video/mp4"));
});

import { combineStandaloneHtmlDecks, prepareStandaloneHtml } from "../../standalone/standalone-html.service";

const htmlAssetA = "00000000-0000-4000-8000-000000000011";
const htmlAssetB = "00000000-0000-4000-8000-000000000012";
function htmlDeck() {
  return { width: 1920, height: 1080, fonts: [],
    css: ".deck-scope .slide {animation: entrance 1s;} @keyframes entrance {from {opacity:0;} to {opacity:1;}}",
    slides: [{ index: 0, classes: "slide", html: '<h1 style="animation: entrance 1s; color: red">Hola</h1>', animationCount: 1, label: "Hola" }],
  };
}

test("multiple HTML assets isolate selectors and animation names, including legacy styles", () => {
  const combined = combineStandaloneHtmlDecks(htmlDeck(), [{ id: htmlAssetA, deck: htmlDeck() }, { id: htmlAssetB, deck: htmlDeck() }])!;
  assert.equal(combined.slides.length, 3);
  assert.ok(combined.css.includes('.deck-scope:not([data-html-asset]) .slide'));
  for (const id of [htmlAssetA, htmlAssetB]) {
    assert.ok(combined.css.includes(`.deck-scope[data-html-asset="${id}"] .slide`));
    assert.ok(combined.css.includes(`@keyframes html-${id}-entrance`));
    assert.ok(combined.slides.find((slide) => slide.htmlAssetId === id)?.html.includes(`animation: html-${id}-entrance`));
  }
});

test("HTML files retain authored clips when another file is inserted earlier", () => {
  const initial = combineStandaloneHtmlDecks(null, [{ id: htmlAssetB, deck: htmlDeck() }])!;
  const document = createInitialCompositionDocument({ animatedDeck: initial, assets: [],
    plan: { title: "HTML", subtitle: "", durationSeconds: 10, accentColor: "#000000" } });
  assert.deepEqual(document.tracks.map((track) => track.label), ["HTML"]);
  document.clips[0].layout.x = 77;
  document.clips[0].durationSeconds = 3;
  const updated = combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck: htmlDeck() }, { id: htmlAssetB, deck: htmlDeck() }])!;
  const reconciled = reconcileCompositionDocument({ document, productionAssets: [], deckDependencyAssetIds: new Set(), animatedDeck: updated }).document;
  assert.equal(reconciled.clips.length, 2);
  assert.equal(reconciled.clips.find((clip) => clip.id === document.clips[0].id)?.layout.x, 77);
  assert.equal(reconciled.clips.find((clip) => clip.id === document.clips[0].id)?.durationSeconds, 3);
  assert.equal(normalizeCompositionTrackTopology(reconciled, new Map()).tracks[0].id, "media-html");
});

test("HTML preparation strips scripts and rejects external media", () => {
  const deck = prepareStandaloneHtml('<html><head><style>.slide{color:red}</style></head><body><section class="slide"><h1>Hola</h1></section><script>alert(1)</script></body></html>');
  assert.equal(deck.slides.length, 1);
  assert.ok(!deck.slides[0].html.includes("script"));
  assert.throws(() => prepareStandaloneHtml('<section class="slide"><img src="https://example.com/a.png"></section>'));
});


import { sanitizeStandaloneSlide, validateStandaloneCss } from "../../standalone/standalone-html-safety.service";
import { compositionClipExclusionKey, isCompositionClipExcluded } from "../composition-source-selection";

test("uploaded markup cannot navigate or retain executable SVG and external CSS", () => {
  const clean = sanitizeStandaloneSlide('<a href="jav&#97;script:alert(1)">Hola</a><svg onload="alert(1)"><foreignObject><iframe srcdoc="bad"></iframe></foreignObject><circle cx="1" cy="1" r="1" /></svg>');
  assert.ok(!/javascript|href|onload|foreignObject|iframe|srcdoc/i.test(clean));
  assert.throws(() => validateStandaloneCss('.slide { background: url(//internal/file); }'));
  assert.throws(() => validateStandaloneCss('.slide { background: url(file:///secret); }'));
});

test("HTML ids and local SVG references are scoped per asset", () => {
  const deck = htmlDeck();
  deck.slides[0].html = '<svg><defs><linearGradient id="paint"><stop offset="0" /></linearGradient></defs><rect fill="url(#paint)" /></svg>';
  const result = combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck }, { id: htmlAssetB, deck }])!;
  for (const [index, id] of [htmlAssetA, htmlAssetB].entries()) {
    assert.ok(result.slides[index].html.includes(`id="html-${id}-paint"`));
    assert.ok(result.slides[index].html.includes(`url(#html-${id}-paint)`));
  }
});

test("HTML source exclusions do not collide with legacy slide indices", () => {
  const document = createInitialCompositionDocument({ animatedDeck: combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck: htmlDeck() }]), assets: [],
    plan: { title: "HTML", subtitle: "", durationSeconds: 10, accentColor: "#000000" } });
  const clip = document.clips[0];
  assert.equal(isCompositionClipExcluded(clip, ['deck:0']), false);
  assert.equal(isCompositionClipExcluded(clip, [compositionClipExclusionKey(clip)]), true);
});

import { compileCompositionPreview } from "../composition-preview-compiler.service";

test("vertical preview keeps separate HTML scopes and original deck proportions", async () => {
  const document = createInitialCompositionDocument({ animatedDeck: combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck: htmlDeck() }, { id: htmlAssetB, deck: htmlDeck() }]), assets: [],
    plan: { title: "Vertical", subtitle: "", durationSeconds: 10, accentColor: "#000000" } });
  const vertical = applyCompositionEditorPatches(document, [{ type: "composition.canvas-size", width: 1080, height: 1920 }]);
  const result = await compileCompositionPreview({ document: vertical, assetUrls: new Map() });
  assert.ok(result.includes('width=1080, height=1920'));
  assert.ok(result.includes(`data-html-asset="${htmlAssetA}"`));
  assert.ok(result.includes(`data-html-asset="${htmlAssetB}"`));
  assert.equal(vertical.deckStyles?.sourceWidth, 1920);
  assert.equal(vertical.deckStyles?.sourceHeight, 1080);
});

test("a legacy deck added later cannot replace an independently uploaded HTML clip", () => {
  const asset = { id: htmlAssetA, deck: htmlDeck() };
  const document = createInitialCompositionDocument({ animatedDeck: combineStandaloneHtmlDecks(null, [asset]), assets: [],
    plan: { title: "Mixed", subtitle: "", durationSeconds: 10, accentColor: "#000000" } });
  const updated = reconcileCompositionDocument({ document, productionAssets: [], deckDependencyAssetIds: new Set(),
    animatedDeck: combineStandaloneHtmlDecks(htmlDeck(), [asset]) }).document;
  assert.equal(updated.clips.length, 2);
  assert.ok(updated.clips.some((clip) => clip.id === 'deck-slide-0'));
  assert.ok(updated.clips.some((clip) => clip.id === document.clips[0].id && clip.source.type === 'DECK_SLIDE' && clip.source.htmlAssetId === htmlAssetA));
});

import { assertCompositionSnapshotRenderContract } from "../composition-snapshot.service";
import { hasCanonicalHtmlSource } from "../../standalone/standalone-timeline-library.service";

function manualDocument() {
  return createInitialCompositionDocument({ sourceInsertionMode: "MANUAL", animatedDeck: combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck: htmlDeck() }]), assets: [],
    plan: { title: "Manual", subtitle: "", durationSeconds: 10, accentColor: "#000000" } });
}

test("standalone starts empty and synchronization only updates its library styles", async () => {
  const document = manualDocument();
  assert.equal(document.clips.length, 0);
  assert.equal(document.tracks.length, 0);
  const asset = { mimeType: "image/png", timelineRole: "MEDIA" as const, productionAssetId: htmlAssetB,
    checksum: "a".repeat(64), fileSizeBytes: 100, storageBucket: "production-render-sources", storagePath: "production-render-sources/media/test.png", publicUrl: null };
  const next = reconcileCompositionDocument({ document, productionAssets: [asset], deckDependencyAssetIds: new Set(),
    animatedDeck: combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck: htmlDeck() }, { id: htmlAssetB, deck: htmlDeck() }]) });
  assert.equal(next.document.clips.length, 0);
  assert.equal(next.document.canvas.durationSeconds, document.canvas.durationSeconds);
  assert.equal(next.changed, true);
  assert.ok(next.document.deckStyles?.css.includes(htmlAssetB));
  const preview = await compileCompositionPreview({ document, assetUrls: new Map() });
  assert.ok(preview.includes('width=1920, height=1080'));
  assert.throws(() => assertCompositionSnapshotRenderContract(document), /timeline/);
});

test("explicit insertion, deletion of the last clip, and reload keep standalone selection manual", () => {
  const document = manualDocument();
  const clip = documentWithMedia(["image/png"]).clips[0];
  const track = documentWithMedia(["image/png"]).tracks[0];
  const inserted = applyCompositionEditorPatches(document, [{ type: "clip.add", clipId: clip.id, clip, track }]);
  assert.equal(inserted.clips.length, 1);
  const removed = applyCompositionEditorPatches(inserted, [{ type: "clip.remove", clipId: clip.id }]);
  assert.equal(removed.clips.length, 0);
  const reconciled = reconcileCompositionDocument({ document: removed, productionAssets: [], deckDependencyAssetIds: new Set(),
    animatedDeck: combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck: htmlDeck() }]) });
  assert.equal(reconciled.document.clips.length, 0);
  assert.equal(reconciled.document.sourceInsertionMode, "MANUAL");
});

test("manual mode preserves previously edited standalone clips and rejects forged HTML sources", () => {
  const legacy = documentWithMedia(["image/png"]);
  legacy.sourceInsertionMode = "MANUAL";
  legacy.clips[0].layout.x = 42;
  const restored = applyCompositionEditorPatches(legacy, [{ type: "document.restore", document: documentWithMedia(["image/png"]) }]);
  assert.equal(restored.sourceInsertionMode, "MANUAL");
  const deckDocument = createInitialCompositionDocument({ animatedDeck: combineStandaloneHtmlDecks(null, [{ id: htmlAssetA, deck: htmlDeck() }]), assets: [],
    plan: { title: "HTML", subtitle: "", durationSeconds: 10, accentColor: "#000000" } });
  const clip = deckDocument.clips[0];
  assert.equal(hasCanonicalHtmlSource(clip, deckDocument.clips), true);
  const forged = structuredClone(clip);
  if (forged.source.type === "DECK_SLIDE") forged.source.html = '<script>bad()</script>';
  assert.equal(hasCanonicalHtmlSource(forged, deckDocument.clips), false);
  assert.equal(hasCanonicalHtmlSource(clip, []), false);
});


test("standalone synchronization preserves manual placement even for legacy scene assets", () => {
  const asset = { mimeType: "video/mp4", timelineRole: "AVATAR" as const, productionAssetId: htmlAssetA,
    sceneClipId: "scene-one", sceneOrder: 1, durationSeconds: 10, hasAudio: true,
    checksum: "a".repeat(64), fileSizeBytes: 100, storageBucket: "production-assets", storagePath: "production-assets/test.mp4", publicUrl: null };
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [asset],
    plan: { title: "Existing standalone", subtitle: "", durationSeconds: 10, accentColor: "#000000" } });
  document.sourceInsertionMode = "MANUAL";
  document.canvas.durationSeconds = 20;
  document.clips[0].startSeconds = 7;
  document.clips[0].durationSeconds = 3;
  document.clips[0].layout.x = 42;
  const newAsset = { ...asset, productionAssetId: htmlAssetB, sceneClipId: "scene-two", sceneOrder: 2 };
  const reconciled = reconcileCompositionDocument({ document, productionAssets: [asset, newAsset], deckDependencyAssetIds: new Set() }).document;
  assert.equal(reconciled.clips.length, 1);
  assert.equal(reconciled.clips[0].startSeconds, 7);
  assert.equal(reconciled.clips[0].durationSeconds, 3);
  assert.equal(reconciled.clips[0].layout.x, 42);
  assert.equal(reconciled.canvas.durationSeconds, 20);
});
