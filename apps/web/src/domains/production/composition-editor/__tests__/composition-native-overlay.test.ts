import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT,
  compositionEditorDocumentSchema,
} from "../composition-document.types";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";

function baseDocument() {
  return createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 0, classes: "slide", html: "<section>Base</section>", index: 0, label: "Base" }],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Texto nativo" },
  });
}

test("creates a transparent caption layer and promotes the document contract to v3", () => {
  const initial = baseDocument();
  const { clip, track } = createCompositionNativeOverlay({
    document: initial,
    id: "caption-test",
    kind: "CAPTION",
    playheadSeconds: 3,
  });
  const edited = applyCompositionEditorPatches(initial, [{
    clip,
    clipId: clip.id,
    ...(track ? { track } : {}),
    type: "clip.add",
  }]);

  assert.equal(edited.format, NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT);
  assert.equal(clip.source.type, "NATIVE_CAPTIONS");
  if (clip.source.type !== "NATIVE_CAPTIONS") return;
  assert.equal(clip.source.style.backgroundOpacity, 0);
  assert.equal(clip.source.style.strokeWidth, 2);
  assert.doesNotThrow(() => compositionEditorDocumentSchema.parse(edited));
});

test("edits text through allow-listed patches and escapes authored markup in preview HTML", async () => {
  const initial = baseDocument();
  const { clip, track } = createCompositionNativeOverlay({
    document: initial,
    id: "text-test",
    kind: "TEXT",
    playheadSeconds: 0,
  });
  const withText = applyCompositionEditorPatches(initial, [{
    clip,
    clipId: clip.id,
    ...(track ? { track } : {}),
    type: "clip.add",
  }]);
  const edited = applyCompositionEditorPatches(withText, [
    { clipId: clip.id, text: "<script>alert('xss')</script>", type: "clip.text-content" },
    { clipId: clip.id, style: { backgroundOpacity: 0.25, textOpacity: 0.8 }, type: "clip.text-style" },
  ]);
  const html = await compileCompositionPreview({ assetUrls: new Map(), document: edited });

  assert.match(html, /&lt;script&gt;alert\('xss'\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\('xss'\)<\/script>/);
  assert.match(html, /background:rgba\(0,0,0,0\.25\)/);
  assert.match(html, /color:rgba\(255,255,255,0\.8\)/);
});

test("renders caption cues on the composition timeline without turning them into clips", async () => {
  const initial = baseDocument();
  const { clip, track } = createCompositionNativeOverlay({
    document: initial,
    id: "caption-timeline",
    kind: "CAPTION",
    playheadSeconds: 0,
  });
  const midpoint = clip.durationSeconds / 2;
  const edited = applyCompositionEditorPatches(initial, [{
    clip,
    clipId: clip.id,
    ...(track ? { track } : {}),
    type: "clip.add",
  }, {
    clipId: clip.id,
    cues: [
      { endSeconds: midpoint, id: "cue-a", startSeconds: 0, text: "Primero" },
      { endSeconds: clip.durationSeconds, id: "cue-b", startSeconds: midpoint, text: "Después" },
    ],
    type: "clip.caption-cues",
  }]);
  const html = await compileCompositionPreview({ assetUrls: new Map(), document: edited });

  assert.match(html, /id="caption-timeline-caption-cue-a" class="composition-caption-cue"/);
  assert.match(html, new RegExp(`"elementId":"caption-timeline-caption-cue-a","end":${midpoint},"start":0`));
  assert.doesNotMatch(html, /class="clip"[^>]*caption-timeline-caption-cue-a/);
});

test("renders word-level karaoke spans and seek-safe opacity events", async () => {
  const initial = baseDocument();
  const { clip, track } = createCompositionNativeOverlay({
    document: initial,
    id: "caption-karaoke",
    kind: "CAPTION",
    playheadSeconds: 0,
  });
  const edited = applyCompositionEditorPatches(initial, [{
    clip,
    clipId: clip.id,
    ...(track ? { track } : {}),
    type: "clip.add",
  }, {
    clipId: clip.id,
    cues: [{
      endSeconds: 2,
      id: "cue-a",
      startSeconds: 0,
      text: "Hola mundo",
      words: [
        { endSeconds: 0.5, id: "word-1", startSeconds: 0, text: "Hola" },
        { endSeconds: 1, id: "word-2", startSeconds: 0.5, text: "mundo" },
      ],
    }],
    origin: "TRANSCRIPT",
    type: "clip.caption-cues",
  }]);
  const html = await compileCompositionPreview({ assetUrls: new Map(), document: edited });

  assert.match(html, /id="caption-karaoke-caption-cue-a-word-word-1" class="composition-caption-word"/);
  assert.match(html, /"words":\[\{"elementId":"caption-karaoke-caption-cue-a-word-word-1","end":0\.5,"start":0\}/);
  assert.match(html, /timeline\.set\(wordElement, \{ opacity: 1 \}, word\.start\)/);
});

test("persists the imported caption origin through the allow-listed patch", () => {
  const initial = baseDocument();
  const { clip, track } = createCompositionNativeOverlay({
    document: initial,
    id: "caption-imported",
    kind: "CAPTION",
    playheadSeconds: 0,
  });
  const edited = applyCompositionEditorPatches(initial, [{
    clip,
    clipId: clip.id,
    ...(track ? { track } : {}),
    type: "clip.add",
  }, {
    clipId: clip.id,
    cues: [{ endSeconds: 2, id: "cue-1", startSeconds: 0, text: "Importado" }],
    origin: "VTT",
    type: "clip.caption-cues",
  }]);
  const imported = edited.clips.find((candidate) => candidate.id === clip.id);

  assert.equal(imported?.source.type, "NATIVE_CAPTIONS");
  if (imported?.source.type === "NATIVE_CAPTIONS") assert.equal(imported.source.origin, "VTT");
});

test("embeds an explicitly resolved custom font and fails closed when it is missing", async () => {
  const initial = baseDocument();
  const fontAssetId = "00000000-0000-4000-8000-000000000701";
  const { clip, track } = createCompositionNativeOverlay({
    document: initial,
    id: "text-custom-font",
    kind: "TEXT",
    playheadSeconds: 0,
  });
  const edited = applyCompositionEditorPatches(initial, [{
    clip,
    clipId: clip.id,
    ...(track ? { track } : {}),
    type: "clip.add",
  }, {
    clipId: clip.id,
    style: { fontAssetId, fontFamily: "Brand Sans" },
    type: "clip.text-style",
  }]);

  await assert.rejects(
    () => compileCompositionPreview({ assetUrls: new Map(), document: edited }),
    /No se resolvió la fuente personalizada Brand Sans/,
  );
  const html = await compileCompositionPreview({
    assetUrls: new Map(),
    document: edited,
    fontAssets: new Map([[fontAssetId, {
      assetId: fontAssetId,
      family: "Brand Sans",
      format: "woff2",
      sourceUrl: "assets/fonts/checksum.woff2",
    }]]),
  });
  assert.match(html, /@font-face \{ font-family: 'Brand Sans'; src: url\("assets\/fonts\/checksum\.woff2"\) format\('woff2'\); font-display: block; \}/);
  assert.match(html, /font-family:'Brand Sans',sans-serif/);
});
