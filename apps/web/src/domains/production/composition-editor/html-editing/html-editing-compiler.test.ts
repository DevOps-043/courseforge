import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { load } from "cheerio";
import { compileHtmlEditingFragment } from "./html-editing-compiler.server";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import { HTML_EDITING_LIMITS, type HtmlEditableManifest, type HtmlEditingSetOverride } from "./html-editing.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";

const uuid = "11111111-1111-4111-8111-111111111111";
const otherUuid = "22222222-2222-4222-8222-222222222222";
const source = `<section id="theme" data-courseforge-theme-token="Palette" data-courseforge-theme-choice="light"><h1 id="title">Original</h1><img id="photo" src="conformance-media/${uuid}"></section>`;
function fixture(sourceHtml = source, overrides: HtmlEditingSetOverride[] = []) {
  const binding = {
    organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64),
    clipId: "intro", templateId: "intro", templateVersion: 1,
    sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), manifestSha256: "0".repeat(64),
  };
  const manifest: HtmlEditableManifest = {
    format: "courseforge-html-editable-manifest-v1", binding, elements: [
      { kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 100, multiline: true },
      { kind: "IMAGE", elementId: "photo", label: "Photo", allowedAssetIds: [uuid, otherUuid], allowedFits: ["CONTAIN", "COVER"] },
      { kind: "THEME", elementId: "theme", label: "Theme", tokenId: "Palette", allowedChoiceIds: ["light", "dark"] },
    ],
  };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  return {
    sourceHtml, encodedManifest: JSON.stringify(manifest), authoritativeBinding: binding,
    encodedState: JSON.stringify({ format: "courseforge-html-editable-override-state-v1", binding, overrides }),
    grantedAssetIds: [uuid, otherUuid],
    imageSources: new Map([[uuid, `conformance-media/${uuid}`], [otherUuid, `conformance-media/${otherUuid}`]]),
  };
}
function rejects(run: () => unknown, code: HtmlEditingValidationError["code"]) {
  assert.throws(run, (error: unknown) => error instanceof HtmlEditingValidationError && error.code === code);
}

test("applies all declared properties without mutating source, state, manifest or maps", () => {
  const params = fixture(source, [
    { operation: "SET_TEXT", elementId: "title", value: "Español & Unicode 🧭\nNext" },
    { operation: "SET_IMAGE", elementId: "photo", assetId: otherUuid, fit: "CONTAIN" },
    { operation: "SET_THEME", elementId: "theme", tokenId: "Palette", choiceId: "dark" },
  ]);
  const before = JSON.stringify(params);
  const result = compileHtmlEditingFragment(params);
  const dom = load(result.html, {}, false);
  assert.equal(dom("#title").text(), "Español & Unicode 🧭\nNext");
  assert.equal(dom("#photo").attr("src"), `conformance-media/${otherUuid}`);
  assert.equal(dom("#photo").css("object-fit"), "contain");
  assert.equal(dom("#theme").attr("data-courseforge-theme-token"), "Palette");
  assert.equal(dom("#theme").attr("data-courseforge-theme-choice"), "dark");
  assert.deepEqual(result.instrumentedElementIds, ["title", "photo", "theme"]);
  assert.equal(dom("[data-courseforge-editable-id]").length, 3);
  assert.equal(JSON.stringify(params), before);
  assert.equal(params.imageSources.size, 2);
  assert.equal(result.compiledSha256, createHash("sha256").update(result.html).digest("hex"));
});

test("same input is deterministic and reset uses original defaults, not previously compiled HTML", () => {
  const params = fixture();
  assert.deepEqual(compileHtmlEditingFragment(params), compileHtmlEditingFragment(params));
  assert.equal(load(compileHtmlEditingFragment(params).html)("#title").text(), "Original");
  const changed = compileHtmlEditingFragment(fixture(source, [{ operation: "SET_TEXT", elementId: "title", value: "Changed" }]));
  rejects(() => compileHtmlEditingFragment({ ...params, sourceHtml: changed.html }), "SOURCE_DIGEST_MISMATCH");
});

test("rejects tampered source, manifest and stale override scope independently", () => {
  const params = fixture();
  rejects(() => compileHtmlEditingFragment({ ...params, sourceHtml: source + " " }), "SOURCE_DIGEST_MISMATCH");
  rejects(() => compileHtmlEditingFragment({ ...params, encodedManifest: params.encodedManifest.replace('"Title"', '"Tampered"') }), "MANIFEST_DIGEST_MISMATCH");
  const state = JSON.parse(params.encodedState);
  state.binding.revisionId = otherUuid;
  rejects(() => compileHtmlEditingFragment({ ...params, encodedState: JSON.stringify(state) }), "STALE_BINDING");
});

test("rejects missing, duplicate and conflicting instrumented IDs", () => {
  rejects(() => compileHtmlEditingFragment(fixture(source.replace('id="title"', 'id="missing"'))), "UNKNOWN_ELEMENT");
  for (const html of [source + '<p id="title">Duplicate</p>', source.replace('id="title"', 'id="title" data-courseforge-editable-id="photo"'), source + '<p data-courseforge-editable-id="unknown">Bad</p>']) {
    rejects(() => compileHtmlEditingFragment(fixture(html)), "INVALID_SOURCE");
  }
});

test("rejects structural text edits, non-image targets and undeclared theme defaults", () => {
  for (const html of [
    source.replace("Original", "<span>Nested</span>"), source.replace('<img id="photo"', '<div id="photo"'),
    source.replace('choice="light"', 'choice="unknown"'), source.replace('token="Palette"', 'token="Other"'),
  ]) rejects(() => compileHtmlEditingFragment(fixture(html)), "INVALID_SOURCE");
});

test("rejects executable HTML, external resources and unsupported CSS/SVG", () => {
  for (const addition of [
    '<script>alert(1)</script>', '<span onclick="alert(1)">Bad</span>', '<iframe src="https://evil.invalid"></iframe>',
    '<img src="https://evil.invalid/a.png">', '<style>@import "https://evil.invalid/style.css";</style>',
    '<style>p{background:url(https://evil.invalid/a.png)}</style>', '<svg><animate attributeName="href" /></svg>',
    '<svg><foreignObject><div>Bad</div></foreignObject></svg>', '<img srcset="https://evil.invalid/a.png 1x">',
  ]) rejects(() => compileHtmlEditingFragment(fixture(source + addition)), "INVALID_SOURCE");
});

test("rejects revoked default on reset but permits replacing it with a currently granted image", () => {
  rejects(() => compileHtmlEditingFragment({ ...fixture(), grantedAssetIds: [otherUuid] }), "INVALID_SOURCE");
  const params = fixture(source, [{ operation: "SET_IMAGE", elementId: "photo", assetId: otherUuid, fit: "COVER" }]);
  assert.ok(compileHtmlEditingFragment({ ...params, grantedAssetIds: [otherUuid] }).html.includes(`src="conformance-media/${otherUuid}"`));
  rejects(() => compileHtmlEditingFragment({ ...params, grantedAssetIds: [uuid] }), "ASSET_NOT_AUTHORIZED");
});

test("rejects missing materialization, remote maps and undeclared late overrides atomically", () => {
  const params = fixture(source, [{ operation: "SET_IMAGE", elementId: "photo", assetId: otherUuid, fit: "COVER" }]);
  rejects(() => compileHtmlEditingFragment({ ...params, imageSources: new Map([[uuid, `conformance-media/${uuid}`]]) }), "ASSET_SOURCE_MISSING");
  rejects(() => compileHtmlEditingFragment({ ...params, imageSources: new Map([[uuid, "https://evil.invalid"]]) }), "ASSET_SOURCE_MISSING");
  rejects(() => compileHtmlEditingFragment(fixture(source, [
    { operation: "SET_TEXT", elementId: "title", value: "Valid" },
    { operation: "SET_THEME", elementId: "theme", tokenId: "Palette", choiceId: "unknown" },
  ])), "VALUE_NOT_DECLARED");
});

test("bounds source bytes and parsed DOM element count", () => {
  rejects(() => compileHtmlEditingFragment(fixture(source + "é".repeat(HTML_EDITING_LIMITS.sourceBytes / 2))), "PAYLOAD_LIMIT");
  rejects(() => compileHtmlEditingFragment(fixture(source + "<span></span>".repeat(HTML_EDITING_LIMITS.sourceElements))), "PAYLOAD_LIMIT");
});

test("permits static local SVG references while preserving unrelated source attributes", () => {
  const html = source + '<svg><defs><clipPath id="crop"><rect width="1" height="1" /></clipPath></defs><g clip-path="url(#crop)"><path d="M0 0L1 1" /></g></svg>';
  const result = compileHtmlEditingFragment(fixture(html));
  assert.ok(result.html.includes('clip-path="url(#crop)"'));
  assert.ok(result.html.includes('d="M0 0L1 1"'));
});

test("fresh grants alone do not authorize an image default outside the template allowlist", () => {
  const foreign = "33333333-3333-4333-8333-333333333333";
  const params = fixture(source.replace(`conformance-media/${uuid}`, `conformance-media/${foreign}`));
  params.imageSources.set(foreign, `conformance-media/${foreign}`);
  params.grantedAssetIds.push(foreign);
  rejects(() => compileHtmlEditingFragment(params), "INVALID_SOURCE");
});

test("reports all actual resource dependencies, including CSS, not unused allowlisted assets", () => {
  assert.deepEqual(compileHtmlEditingFragment(fixture()).usedAssetIds, [uuid]);
  const html = source + `<style>.decor{background-image:url(conformance-media/${otherUuid})}</style>`;
  assert.deepEqual(compileHtmlEditingFragment(fixture(html)).usedAssetIds, [uuid, otherUuid]);
  const changed = compileHtmlEditingFragment(fixture(source, [{ operation: "SET_IMAGE", elementId: "photo", assetId: otherUuid, fit: "COVER" }]));
  assert.deepEqual(changed.usedAssetIds, [otherUuid]);
});
