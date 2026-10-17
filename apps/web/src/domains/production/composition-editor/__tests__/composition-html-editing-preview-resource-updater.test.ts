import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlPreviewResourceUpdater, HTML_PREVIEW_RESOURCE_UPDATE_POLICY } from "../composition-html-editing-preview-resource-updater.client";
import type { HtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.contract";

const documentId = "11111111-1111-4111-8111-111111111111", audience = "https://app.example.test";
const session = { version: 1 as const, nonce: "a".repeat(64), documentHash: "b".repeat(64), previewGeneration: 2 };
function record(issuedAt: number): HtmlPreviewResourceRenewal {
  return { format: "courseforge-html-preview-resource-renewal-v1", documentId, session, bundleSha256: "c".repeat(64),
    inventoryFingerprint: "d".repeat(64), issuedAt, expiresAt: issuedAt + 180,
    resources: [{ localPath: `conformance-media/${documentId}`,
      url: `${audience}/api/production/hyperframes/drafts/${documentId}/html-preview/resources?cap=body${issuedAt}.signature` }] };
}
const oldUrl = record(100).resources[0]!.url, newUrl = record(220).resources[0]!.url;
class Declaration {
  values: Map<string, string>; writes = 0;
  constructor(values: Record<string, string>) { this.values = new Map(Object.entries(values)); }
  get length() { return this.values.size; }
  item(index: number) { return [...this.values.keys()][index]!; }
  getPropertyValue(name: string) { return this.values.get(name)!; }
  getPropertyPriority() { return "important"; }
  setProperty(name: string, value: string, priority: string) { assert.equal(priority, "important"); this.values.set(name, value); this.writes++; }
}
class ElementFixture {
  values: Map<string, string>; writes = 0; loads = 0; textContent = "Keep source text";
  style = new Declaration({}); parentElement: ElementFixture | null = null;
  constructor(readonly localName: string, attributes: Record<string, string>) { this.values = new Map(Object.entries(attributes)); }
  get attributes() { return [...this.values].map(([name, value]) => ({ name, value, namespaceURI: null })); }
  setAttribute(name: string, value: string) { this.values.set(name, value); this.writes++; }
  load() { this.loads++; }
}
function fixture() {
  const video = new ElementFixture("video", { src: oldUrl, "data-hf-id": "keep-video" });
  const image = new ElementFixture("img", { src: oldUrl, style: `background:url("${oldUrl}")` });
  image.style = new Declaration({ background: `url("${oldUrl}")`, content: `'url(${oldUrl})'` });
  const svg = new ElementFixture("g", { filter: "url(#mask)", fill: `url("${oldUrl}")` });
  const script = new ElementFixture("script", {}); script.textContent = oldUrl;
  const styleElement = new ElementFixture("style", {}); styleElement.textContent = oldUrl;
  const font = new Declaration({ src: `url("${oldUrl}")`, "font-family": "Pinned Font" });
  const elements = [video, image, svg, script, styleElement];
  const document = { querySelectorAll: () => elements, styleSheets: [{ cssRules: [{ cssRules: [{ style: font }] }] }] } as unknown as Document;
  return { video, image, svg, script, styleElement, font, elements, document };
}

test("frame updater changes URL sinks/CSSOM only, preserves text/script/style source and reloads media once", () => {
  const f = fixture(), updater = createHtmlPreviewResourceUpdater({ initial: record(100), audience, document: f.document, nowSeconds: () => 220 });
  const result = updater.apply(record(220), new AbortController().signal);
  assert.equal(f.video.values.get("src"), newUrl); assert.equal(f.video.loads, 1);
  assert.equal(f.image.values.get("src"), newUrl); assert.ok(f.image.style.values.get("background")!.includes(newUrl));
  assert.equal(f.image.style.values.get("content"), `'url(${oldUrl})'`);
  assert.equal(f.svg.values.get("filter"), "url(#mask)"); assert.ok(f.svg.values.get("fill")!.includes(newUrl));
  assert.ok(f.font.values.get("src")!.includes(newUrl)); assert.equal(f.font.values.get("font-family"), "Pinned Font");
  assert.equal(f.script.textContent, oldUrl); assert.equal(f.styleElement.textContent, oldUrl);
  assert.equal(f.video.values.get("data-hf-id"), "keep-video"); assert.equal(result.reloadedMedia, 1); assert.equal(result.changedSinks, 5);
  updater.dispose();
});

test("preflight rejects unknown URL, unsafe attributes, identity/alias drift, expiry and oversized DOM before any write", () => {
  for (const scenario of ["url", "attribute", "identity", "alias", "expired", "nodes"]) {
    const f = fixture(); const renewal = record(220);
    if (scenario === "url") f.svg.values.set("fill", 'url("https://foreign.test/private")');
    if (scenario === "attribute") f.svg.values.set("srcset", "unchecked 2x");
    if (scenario === "identity") renewal.inventoryFingerprint = "e".repeat(64);
    if (scenario === "alias") renewal.resources[0]!.localPath = "conformance-media/22222222-2222-4222-8222-222222222222";
    if (scenario === "nodes") f.elements.length = HTML_PREVIEW_RESOURCE_UPDATE_POLICY.nodes + 1;
    const updater = createHtmlPreviewResourceUpdater({ initial: record(100), audience, document: f.document, nowSeconds: () => scenario === "expired" ? 280 : 220 });
    assert.throws(() => updater.apply(renewal, new AbortController().signal), /^Error: HTML_PREVIEW_RESOURCE_UPDATE_REJECTED$/);
    assert.equal(f.video.writes, 0, scenario); assert.equal(f.video.loads, 0); assert.equal(f.image.style.writes, 0); updater.dispose();
  }
});

test("abort or mutation failure is terminal, never rolls back to expired capabilities or accepts a retry", () => {
  for (const scenario of ["abort", "write"]) {
    const f = fixture(), abort = new AbortController();
    const updater = createHtmlPreviewResourceUpdater({ initial: record(100), audience, document: f.document, nowSeconds: () => 220 });
    if (scenario === "abort") abort.abort(); else f.video.setAttribute = () => { throw new Error("private DOM details"); };
    assert.throws(() => updater.apply(record(220), abort.signal), /^Error: HTML_PREVIEW_RESOURCE_UPDATE_REJECTED$/);
    assert.throws(() => updater.apply(record(220), new AbortController().signal), /^Error: HTML_PREVIEW_RESOURCE_UPDATE_REJECTED$/);
    assert.equal(f.video.loads, 0); updater.dispose();
  }
});
