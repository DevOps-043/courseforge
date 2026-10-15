import assert from "node:assert/strict";
import test from "node:test";
import { prepareCompositionHtmlEditingDeckStyles } from "../composition-html-editing-deck-styles.server";
import { prepareHtmlHistoricalReconstruction } from "../composition-html-editing-historical-reconstruction.server";
import { createMultipageHtmlReconstructionFixture } from "./composition-html-editing-reconstruction-fixtures";
import { hashCompositionDocument } from "../composition-document.service";
import { compileCompositionHtmlEditingFragments } from "../composition-html-editing-compilation.server";
import { parseHtmlEditingStaticSource } from "../html-editing/html-editing-static-source.server";
import { HTML_EDITING_LIMITS } from "../html-editing/html-editing.contract";
import { createHash } from "node:crypto";
import { createHtmlReconstructionFixture } from "./composition-html-editing-reconstruction-fixtures";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { compileCompositionPreview, CompositionPreviewCompilerError } from "../composition-preview-compiler.service";
import { load } from "cheerio";
import { Script, createContext } from "node:vm";

function fixture(css = ".title {color:red;width:120px} #title-0 {font-size:24px}") {
  const f = createMultipageHtmlReconstructionFixture(), prepared = prepareHtmlHistoricalReconstruction(f);
  const document = {...prepared.document, deckStyles: {css, fontUrls: [] as string[]}};
  const documentHash = hashCompositionDocument(document);
  const context = {organizationId: f.origin.organizationId, documentId: f.target.documentId, documentHash,
    revisions: prepared.initialRevisions.map(initial => ({encodedRevision: JSON.stringify(initial.revision),
      authoritativeBinding: initial.revision.manifest.binding, grantedAssetIds: f.grantedAssetIds, imageSources: f.imageSources}))};
  return {document, documentHash, context, assetUrls: f.imageSources};
}
test("contextual stylesheet derives the exact existing fragment scopes without changing sources or pointers", () => {
  const f = fixture(), before = structuredClone(f.document), derived = prepareCompositionHtmlEditingDeckStyles(f);
  const fragments = compileCompositionHtmlEditingFragments(f);
  const scopes = [...fragments.values()].map(html => /data-courseforge-html-scope="([a-f0-9]{64})"/.exec(html)![1]);
  assert.equal(new Set(scopes).size, 3);
  for (const scope of scopes) assert.ok(derived.includes(`:where([data-courseforge-html-scope="${scope}"]) :is(.title)`));
  assert.deepEqual(f.document, before);
  assert.equal(prepareCompositionHtmlEditingDeckStyles({...f, context: {...f.context, revisions: [...f.context.revisions].reverse()}}), derived);
  assert.doesNotMatch(derived, /(^|\n)\.title\s*\{/);
});

test("actual emitted preview readiness denies pending, missing and failed layout runtimes without announcing READY", async () => {
  const f = fixture();
  const html = await compileCompositionPreview({document: f.document, documentHash: f.documentHash,
    assetUrls: f.assetUrls, htmlEditingCompilation: f.context});
  const source = load(html)("script").toArray().map(element => load(html)(element).text())
    .find(script => script.includes("const compiledDocumentHash ="))!;
  const start = source.indexOf("const admitHtmlLayout ="), end = source.indexOf("const queueAspectCorrection =");
  assert.ok(start >= 0 && end > start);
  for (const status of ["PENDING", "READY", "FAILED", "MISSING"] as const) {
    const messages: Array<{type: string}> = [];
    let assertions = 0, pauses = 0;
    const context = createContext({htmlLayoutRequired: true, htmlLayout: status === "MISSING" ? undefined : {
      getState: () => status, assert: () => { assertions++; if (status !== "READY") throw new Error(); },
    }, initialMediaReady: false, htmlLayoutFailureReported: false,
    root: {setAttribute() {}}, pause: () => { pauses++; }, postParentMessage: (message: {type: string}) => messages.push(message),
    compiledDocumentHash: f.documentHash, previewGeneration: 1, pendingMediaAt: () => [], currentTime: 0,
    emitMediaMetric() {}, previewStartedAt: 0, activeMedia: [], mediaIdentity() {}, postMediaState() {}, duration: 10, selectedHfId: null,
  });
    const script = new Script(`${source.slice(start, end)}; announceInitialReadyIfPossible(); announceInitialReadyIfPossible();`);
    script.runInContext(context);
    assert.equal(messages.filter(message => message.type === "courseforge-composition-ready").length, status === "READY" ? 1 : 0);
    assert.equal(messages.filter(message => message.type === "courseforge-composition-load-error").length,
      status === "FAILED" || status === "MISSING" ? 1 : 0);
    if (status === "PENDING") { assert.equal(assertions, 0); assert.equal(pauses, 0); }
  }
});
test("global document roots, interactive clocks, unsafe geometry, markup and nested selectors reject rather than strip", () => {
  for (const css of ["body{color:red}", ":root{font-size:24px}", ".title:hover{color:red}",
    ".title{animation:clock 2s}", ".title{width:999999px}", "@font-face{font-family:test;src:url(https://foreign.test/font.woff2)}",
    ".title{background:url(https://foreign.test/image.png)}", ".title{& span{color:red}}", ".title{color:</style><script>x</script>}"])
    assert.throws(() => prepareCompositionHtmlEditingDeckStyles(fixture(css)));
});
test("contextual CSS layers and pseudo-elements reuse fragment isolation semantics and stable identities", () => {
  const f = fixture("@layer design { .title::before{content:'x';font-size:20px} }");
  const derived = prepareCompositionHtmlEditingDeckStyles(f);
  assert.equal([...derived.matchAll(/@layer cf_[a-f0-9]{64}\.design/g)].length, 3);
  assert.equal([...derived.matchAll(/:is\(\.title\)::before/g)].length, 3);
  assert.throws(() => prepareCompositionHtmlEditingDeckStyles(fixture("@layer design{@layer nested{.title{color:red}}}")));
});
test("font URLs, CSS resource dependencies and unbound neighbouring HTML cannot bypass the resource ledger", () => {
  const remote = fixture(); remote.document.deckStyles.fontUrls = ["https://foreign.test/font.woff2"];
  remote.documentHash = hashCompositionDocument(remote.document); remote.context.documentHash = remote.documentHash;
  assert.throws(() => prepareCompositionHtmlEditingDeckStyles(remote), /UNSUPPORTED/);
  const f = fixture(), [assetId] = f.assetUrls.keys();
  assert.throws(() => prepareCompositionHtmlEditingDeckStyles(fixture(`.title{background:url(conformance-media/${assetId})}`)), /RESOURCES_UNSUPPORTED/);
  const neighbour = fixture(); neighbour.document.clips.push({...neighbour.document.clips[0], id: "unbound", hfId: "unbound"});
  neighbour.documentHash = hashCompositionDocument(neighbour.document); neighbour.context.documentHash = neighbour.documentHash;
  assert.throws(() => prepareCompositionHtmlEditingDeckStyles(neighbour), /UNSUPPORTED/);
});
test("global and fragment CSS share one aggregate admission budget, not separate allowances", () => {
  const fragmentCss = `/*${"a".repeat(100_000)}*/`, contextualCss = `/*${"a".repeat(170_000)}*/`;
  assert.ok(Buffer.byteLength(fragmentCss) < HTML_EDITING_LIMITS.cssBytes);
  assert.ok(Buffer.byteLength(contextualCss) < HTML_EDITING_LIMITS.cssBytes);
  assert.throws(() => parseHtmlEditingStaticSource(`<style>${fragmentCss}</style><div>title</div>`, contextualCss), /PAYLOAD_LIMIT/);
  assert.doesNotThrow(() => parseHtmlEditingStaticSource("<div style='font-size:24px'>title</div>", ".title{color:red}"));
});
test("native/revision identity mismatch still fails before contextual styles can be derived", () => {
  const f = fixture(); assert.throws(() => prepareCompositionHtmlEditingDeckStyles({...f, documentHash: "f".repeat(64)}));
  assert.throws(() => prepareCompositionHtmlEditingDeckStyles({...f, context: {...f.context, revisions: f.context.revisions.slice(1)}}));
  assert.throws(() => prepareCompositionHtmlEditingDeckStyles({...f, context: {...f.context,
    revisions: f.context.revisions.map(entry => ({...entry, authoritativeBinding: {...entry.authoritativeBinding, templateVersion: 99}}))}}));
});

test("both concrete compiler targets enforce CSS SVG viewport bounds without rewriting native source", async () => {
  const f = createHtmlReconstructionFixture(), clip = f.document.clips[0];
  if (clip.source.type !== "DECK_SLIDE") throw new Error();
  const digest = (html: string) => createHash("sha256").update(html).digest("hex");
  const template = JSON.parse(f.catalog.resolve({organizationId: f.origin.organizationId,
    templateId: "intro", templateVersion: 1, sourceSha256: digest(clip.source.html)}));
  clip.source.html += '<svg class="viewport" width="1" height="1" viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>';
  template.sourceSha256 = digest(clip.source.html);
  f.catalog = new HtmlEditingTemplateCatalog(JSON.stringify({format: "courseforge-html-editable-catalog-v1",
    organizationId: f.origin.organizationId, templates: [template]}));
  f.expectedDocumentHash = hashCompositionDocument(f.document);
  const prepared = prepareHtmlHistoricalReconstruction(f);
  for (const css of [".viewport{width:32px;height:32px}", ".viewport{width:2px;height:2px}"]) {
    const document = {...prepared.document, deckStyles: {css, fontUrls: [] as string[]}}, documentHash = hashCompositionDocument(document);
    const before = structuredClone(document);
    const context = {organizationId: f.origin.organizationId, documentId: f.target.documentId, documentHash,
      revisions: prepared.initialRevisions.map(initial => ({encodedRevision: JSON.stringify(initial.revision),
        authoritativeBinding: initial.revision.manifest.binding, grantedAssetIds: f.grantedAssetIds, imageSources: f.imageSources}))};
    const derivedFragments: string[] = [];
    for (const target of ["INTERACTIVE_PREVIEW", "HYPERFRAMES_RENDER"] as const) {
      const compilation = compileCompositionPreview({document, documentHash, assetUrls: f.imageSources, htmlEditingCompilation: context, target});
      if (css.includes("32px")) await assert.rejects(compilation, error => error instanceof CompositionPreviewCompilerError
        && error.message.includes("CSS contextual estático"));
      else {
        const html = await compilation; assert.ok(html.includes("width:2px;height:2px"));
        assert.ok(html.includes('"__courseforgeHtmlLayout"'));
        assert.ok(html.includes("HTML_COMPUTED_LAYOUT_UNAVAILABLE"));
        if (target === "INTERACTIVE_PREVIEW") {
          assert.ok(html.includes("if (!admitHtmlLayout()) return false;"));
          assert.ok(html.includes("htmlLayout.ready.then"));
        }
        derivedFragments.push(load(html)(".deck-stage > section").html()!);
      }
    }
    if (derivedFragments.length) assert.equal(derivedFragments[0], derivedFragments[1]);
    assert.deepEqual(document, before);
  }
});
