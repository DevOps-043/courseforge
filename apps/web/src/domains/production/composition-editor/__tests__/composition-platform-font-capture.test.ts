import assert from "node:assert/strict";
import test from "node:test";
import { resolveConformanceFontEvent, startConformancePlatformFontCapture } from "../qa/composition-platform-font-capture";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { conformanceFontPath } from "../composition-conformance-font-bindings";
import { hashTextParityContent } from "../composition-text-checkpoint-plan";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import type { TextParityEvidence } from "../qa/composition-text-parity-evidence";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";

const origin = "http://127.0.0.1:1234";
const font = {fontAssetId: "70000000-0000-4000-8000-000000000001", family: "Editorial Alias", mimeType: "font/woff2" as const,
  checksumSha256: "a".repeat(64), fileSizeBytes: 8};
const event = {fontFamily: font.family, platformFontFamily: "Internal Font Name", src: `${origin}/${conformanceFontPath(font)}`};
const usage = {familyName: event.platformFontFamily, postScriptName: "Internal-Regular", isCustomFont: true, glyphCount: 5};
function documentFixture() {
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [], sourceInsertionMode: "MANUAL",
    plan: {accentColor: "#38BDF8", durationSeconds: 8, title: "Fonts", subtitle: "Actual glyph use"}});
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  clip.source.style.fontAssetId = font.fontAssetId; clip.source.style.fontFamily = font.family;
  if (track) document.tracks.push(track); document.clips.push(clip);
  return document;
}
function checkpoint(): TextParityEvidence["checkpoints"][number] {
  const text = {elementId: "native-motion", textSha256: hashTextParityContent("Texto")};
  return {frameIndex: 0, timeSeconds: 0, policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "CAPTURED",
    expectedTexts: [text], regions: [{...text, left: 0, top: 0, width: 100, height: 20}], unavailable: []};
}
function adapter() {
  let handler: ((event: Record<string, unknown>) => void) | undefined;
  let response: unknown = [usage]; let failEnable = false;
  const calls: string[] = [];
  const client: CompositionQaCdpClient = {close() {}, onEvent(method, callback) {
    assert.equal(method, "CSS.fontsUpdated"); handler = callback; return () => {handler = undefined;};
  }, async send(method) {
    calls.push(method);
    if (failEnable && method === "CSS.enable") throw new Error("controlled enable failure");
    if (method === "Runtime.evaluate") return {result: {objectId: "native-ref"}};
    if (method === "DOM.requestNode") return {nodeId: 42};
    if (method === "CSS.getPlatformFontsForNode") return {fonts: response};
    return {};
  }};
  return {client, calls, emit: (fontEvent: unknown) => handler?.({font: fontEvent}),
    setUsage(value: unknown) {response = value;}, failEnable() {failEnable = true;}, subscribed: () => !!handler};
}

test("loaded font events bind CSS aliases to internal names only through the exact frozen local file", () => {
  assert.equal(resolveConformanceFontEvent(event, [font], origin).platformFamily, "Internal Font Name");
  assert.doesNotThrow(() => resolveConformanceFontEvent({...event, src: `url("${conformanceFontPath(font)}") format('woff2')`}, [font], origin));
  for (const src of ["local('Editorial Alias')", `${event.src}?token=private`, `${event.src}#fragment`,
    event.src.replace(origin, "https://external.invalid"), event.src.replace("a".repeat(64), "b".repeat(64))]) {
    assert.throws(() => resolveConformanceFontEvent({...event, src}, [font], origin));
  }
  assert.throws(() => resolveConformanceFontEvent({...event, fontFamily: "Other"}, [font], origin));
});

test("platform capture accepts an actual custom family with a different CSS alias and releases CDP objects", async () => {
  const browser = adapter(); const capture = await startConformancePlatformFontCapture(browser.client, [font], documentFixture(), origin);
  try {
    browser.emit(event);
    assert.deepEqual(await capture.verify(checkpoint()), [{elementId: "native-motion", fontAssetId: font.fontAssetId,
      platformFamily: event.platformFontFamily, fonts: [usage]}]);
    assert.ok(browser.calls.indexOf("DOM.enable") < browser.calls.indexOf("CSS.enable"));
    assert.equal(browser.calls.at(-1), "Runtime.releaseObject");
  } finally {capture.close();}
  assert.equal(browser.subscribed(), false);
});

test("a single system fallback glyph, another custom family or malformed usage rejects and releases references", async () => {
  const browser = adapter(); const capture = await startConformancePlatformFontCapture(browser.client, [font], documentFixture(), origin);
  try {
    browser.emit(event);
    for (const invalid of [[usage, {...usage, isCustomFont: false, glyphCount: 1}], [{...usage, familyName: "Wrong custom"}],
      [{...usage, glyphCount: -1}], [{...usage, glyphCount: NaN}], [], undefined]) {
      browser.setUsage(invalid);
      await assert.rejects(capture.verify(checkpoint()));
      assert.equal(browser.calls.at(-1), "Runtime.releaseObject");
    }
  } finally {capture.close();}
});

test("zero glyph usage needs independently verified absence, not merely a missing region", async () => {
  const browser = adapter(); const capture = await startConformancePlatformFontCapture(browser.client, [font], documentFixture(), origin);
  try {
    browser.emit(event); browser.setUsage([]);
    const hidden = checkpoint(); hidden.expectedTexts[0]!.visibility = "HIDDEN"; hidden.regions[0]!.visibility = "HIDDEN";
    assert.deepEqual(await capture.verify(hidden), [{elementId: "native-motion", fontAssetId: font.fontAssetId,
      platformFamily: event.platformFontFamily, fonts: []}]);
    hidden.regions = [];
    await assert.rejects(capture.verify(hidden), /GLYPH_USAGE_MISSING/);
  } finally {capture.close();}
});

test("missing events, ambiguous platform identity and invalid event sources cannot certify usage", async () => {
  const browser = adapter(); const other = {...font, fontAssetId: "70000000-0000-4000-8000-000000000002", family: "Other Alias", checksumSha256: "b".repeat(64)};
  const capture = await startConformancePlatformFontCapture(browser.client, [font, other], documentFixture(), origin);
  try {
    await assert.rejects(capture.verify(checkpoint()), /LOADED_EVENT_MISSING/);
    browser.emit(event);
    browser.emit({...event, fontFamily: other.family, src: `${origin}/${conformanceFontPath(other)}`});
    await assert.rejects(capture.verify(checkpoint()), /EVENT_INVALID/);
  } finally {capture.close();}
  const badBrowser = adapter(); const badCapture = await startConformancePlatformFontCapture(badBrowser.client, [font], documentFixture(), origin);
  try {badBrowser.emit({...event, src: "https://external.invalid/font.woff2"}); await assert.rejects(badCapture.verify(checkpoint()), /EVENT_INVALID/);}
  finally {badCapture.close();}
});

test("event quotas, failed setup and empty manifests have bounded cleanup semantics", async () => {
  const browser = adapter(); const capture = await startConformancePlatformFontCapture(browser.client, [font], documentFixture(), origin);
  try {for (let index = 0; index < 513; index++) browser.emit(undefined); await assert.rejects(capture.verify(checkpoint()), /EVENT_INVALID/);}
  finally {capture.close();}
  const failing = adapter(); failing.failEnable();
  await assert.rejects(startConformancePlatformFontCapture(failing.client, [font], documentFixture(), origin));
  assert.equal(failing.subscribed(), false);
  const empty = adapter(); const noFonts = await startConformancePlatformFontCapture(empty.client, [], documentFixture(), origin);
  assert.deepEqual(await noFonts.verify(checkpoint()), []); assert.equal(empty.calls.length, 0); noFonts.close();
});
