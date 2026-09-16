import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { load } from "cheerio";
import { materializeHyperframesRenderMedia } from "../hyperframes-render-media.service";

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
