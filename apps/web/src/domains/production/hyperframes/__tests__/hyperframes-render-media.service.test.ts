import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { load } from "cheerio";
import { materializeHyperframesRenderMedia } from "../hyperframes-render-media.service";
import { createInitialCompositionDocument } from "../../composition-editor/composition-document.factory";
import { hashCompositionDocument } from "../../composition-editor/composition-document.service";
import { applyCompositionEditorPatches } from "../../composition-editor/editor-patch.service";
import { COMPOSITION_COMPILATION_TARGETS, compileCompositionPreview } from "../../composition-editor/composition-preview-compiler.service";
import { assertCompositionSnapshotRenderContract } from "../../composition-editor/composition-snapshot.service";
import { buildHyperframesAssetVariableName } from "../hyperframes-asset-delivery.service";

async function archive(html: string) {
  const zip = new JSZip();
  zip.file("index.html", html);
  zip.file("assets/gsap.min.js", "/* original runtime */");
  return zip.generateAsync({ type: "uint8array" });
}

test("supplies authored src for the audio mixer and video decoder, including approved legacy snapshots", async () => {
  const original = await archive(`<!doctype html><html><body>
    <video id="avatar" data-hf-src="cf_asset_avatar" data-start="4" data-media-start="12" muted></video>
    <audio id="voice" data-var-src="cf_asset_voice" data-start="4" data-duration="8" data-volume="0.7"></audio>
    <audio id="music" data-hf-src="cf_asset_music" data-start="0" data-duration="20"></audio>
    <img data-var-src="cf_asset_image">
    <script>window.keep = "<original>";</script></body></html>`);
  const variables = {
    cf_asset_avatar: "https://storage.test/avatar.mp4?v=123",
    cf_asset_voice: "https://storage.test/voice.mp3?token=temporary&v=456",
    cf_asset_music: "https://storage.test/music.mp3",
    cf_asset_image: "https://storage.test/logo.png",
  };
  const prepared = await materializeHyperframesRenderMedia({ archive: original, entryPoint: "index.html", assetVariables: variables });
  const zip = await JSZip.loadAsync(prepared);
  const $ = load(await zip.file("index.html")!.async("string"));
  // HyperFrames extracts audio before scripts run, using audio[id][src].
  assert.equal($("audio[id][src]").length, 2);
  assert.equal($("video[src]").length, 1);
  assert.equal($("[data-hf-src]").length, 0);
  for (const [variable, url] of Object.entries(variables)) {
    assert.equal($(`[data-var-src="${variable}"]`).attr("src"), url);
  }
  assert.equal($("#avatar").attr("data-media-start"), "12");
  assert.equal($("#voice").attr("data-start"), "4");
  assert.equal($("#voice").attr("data-volume"), "0.7");
  assert.equal($("script").text(), 'window.keep = "<original>";');
  assert.equal(await zip.file("assets/gsap.min.js")!.async("string"), "/* original runtime */");
  // Signed URLs belong only to the upload copy, never the persisted snapshot.
  assert.doesNotMatch(await (await JSZip.loadAsync(original)).file("index.html")!.async("string"), /token=temporary/);
  assert.equal(Object.keys(zip.files).some((name) => /\.(mp3|mp4)$/.test(name)), false);
});

test("fails before upload if any remote binding cannot resolve", async () => {
  const bytes = await archive('<audio id="voice" data-hf-src="cf_asset_missing"></audio>');
  await assert.rejects(materializeHyperframesRenderMedia({ archive: bytes, entryPoint: "index.html", assetVariables: {} }), /Falta la URL autorizada/);
});

test("rejects media that the provider would silently omit", async () => {
  for (const html of ['<video id="avatar"></video>', '<audio id="voice"></audio>', '<audio src="https://storage.test/voice.mp3"></audio>']) {
    await assert.rejects(materializeHyperframesRenderMedia({ archive: await archive(html), entryPoint: "index.html", assetVariables: {} }), /no tiene src|no tiene identificador/);
  }
});

test("does not accept unsafe delivery URLs or a missing entry point", async () => {
  const bytes = await archive('<audio id="voice" data-var-src="cf_asset_voice"></audio>');
  await assert.rejects(materializeHyperframesRenderMedia({ archive: bytes, entryPoint: "missing.html", assetVariables: {} }), /HTML de entrada/);
  for (const url of ["http://storage.test/a.mp3", "https://user:password@storage.test/a.mp3"]) {
    await assert.rejects(materializeHyperframesRenderMedia({ archive: bytes, entryPoint: "index.html", assetVariables: { cf_asset_voice: url } }), /HTTPS sin credenciales/);
  }
});

test("preserves a frozen video tail from immutable snapshot through upload materialization", async () => {
  const previousFlag = process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE;
  process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE = "true";
  try {
    const assetId = "50000000-0000-4000-8000-000000000099";
    const document = createInitialCompositionDocument({
      animatedDeck: null,
      assets: [{ checksum: "a".repeat(64), durationSeconds: 2, fileSizeBytes: 1024, hasAudio: false, mimeType: "video/mp4", productionAssetId: assetId, publicUrl: null, storageBucket: "production-assets", storagePath: "broll/frozen.mp4", timelineRole: "BROLL" }],
      plan: { accentColor: "#38BDF8", durationSeconds: 3, subtitle: "Prueba", title: "Frozen snapshot" },
    });
    document.canvas.durationSeconds = 3;
    const video = document.clips.find((clip) => clip.kind === "VIDEO")!;
    video.durationSeconds = 3;
    const frozen = applyCompositionEditorPatches(document, [{ clipId: video.id, enabled: true, type: "clip.freeze-tail" }]);
    assert.doesNotThrow(() => assertCompositionSnapshotRenderContract(frozen));
    delete process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE;
    const variable = buildHyperframesAssetVariableName(assetId);
    const snapshotHtml = await compileCompositionPreview({
      assetUrls: new Map(),
      assetVariableNames: new Map([[assetId, variable]]),
      document: frozen,
      target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
    });
    const snapshot = new JSZip();
    snapshot.file("index.html", snapshotHtml);
    snapshot.file("composition-document.json", JSON.stringify(frozen));
    const signedUrl = "https://storage.test/frozen.mp4?token=short-lived";
    const originalBytes = await snapshot.generateAsync({ type: "uint8array" });
    const preparedBytes = await materializeHyperframesRenderMedia({
      archive: originalBytes, assetVariables: { [variable]: signedUrl }, entryPoint: "index.html",
    });
    const prepared = await JSZip.loadAsync(preparedBytes);
    const $ = load(await prepared.file("index.html")!.async("string"));
    const media = $(`video[id="${video.id}-media"]`);
    assert.equal(media.length, 1);
    assert.equal(media.attr("src"), signedUrl);
    assert.equal(media.attr("data-var-src"), variable);
    assert.equal(media.attr("data-start"), "0");
    assert.equal(media.attr("data-duration"), "3");
    assert.equal(media.attr("data-source-offset"), "0");
    assert.equal(media.attr("data-media-start"), "0");
    assert.equal(media.attr("loop"), undefined);
    assert.equal($(`audio[id="${video.id}-audio"]`).length, 0);
    assert.equal(hashCompositionDocument(JSON.parse(await prepared.file("composition-document.json")!.async("string"))), hashCompositionDocument(frozen));
    assert.doesNotMatch(await (await JSZip.loadAsync(originalBytes)).file("index.html")!.async("string"), /short-lived/);
    assert.doesNotMatch(await prepared.file("composition-document.json")!.async("string"), /short-lived/);
  } finally {
    if (previousFlag === undefined) delete process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE;
    else process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE = previousFlag;
  }
});
