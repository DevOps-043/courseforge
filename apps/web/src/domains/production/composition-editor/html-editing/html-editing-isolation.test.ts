import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import postcss from "postcss";
import { prepareInitialHtmlEditingRevision } from "./html-editing-bootstrap.server";
import { HTML_EDITING_SCOPE_ATTRIBUTE } from "./html-editing-isolation.server";

const uuid = "11111111-1111-4111-8111-111111111111";
function compile(css: string, clipId = "first", content = "Original") {
  const sourceHtml = `<style>${css}</style><section><p id="title_${clipId}" class="shared">${content}</p></section>`;
  const revision = prepareInitialHtmlEditingRevision({
    authoritativeAnchor: { organizationId: uuid, documentId: uuid, revisionId: uuid,
      documentSha256: "a".repeat(64), clipId },
    encodedTrustedTemplate: JSON.stringify({ format: "courseforge-html-editable-template-v1",
      templateId: "template", templateVersion: 1, sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"),
      elements: [{ kind: "TEXT", elementId: `title_${clipId}`, label: "Title", maxCharacters: 100, multiline: true }] }),
    sourceHtml, grantedAssetIds: [], imageSources: new Map(),
  });
  return { sourceHtml, revision, dom: load(revision.compiled.html, {}, false) };
}

test("compiler scopes every comma branch and complex selector subject away from host and other clips", () => {
  const first = compile(".shared, section > p, :is(.shared, section p){color:red}");
  const second = compile(".shared{color:blue}", "second");
  const page = load(`<p id="host" class="shared">Host</p>${first.revision.compiled.html}${second.revision.compiled.html}`);
  const rules = postcss.parse(first.dom("style").text());
  rules.walkRules(rule => {
    assert.equal(rule.selectors.length, 3);
    for (const selector of rule.selectors) {
      assert.deepEqual(page(selector).map((_index, node) => page(node).attr("id")).get(), ["title_first"]);
      assert.ok(selector.startsWith(":where([data-courseforge-html-scope="));
    }
  });
  assert.notEqual(first.dom(`[${HTML_EDITING_SCOPE_ATTRIBUTE}]`).attr(HTML_EDITING_SCOPE_ATTRIBUTE),
    second.dom(`[${HTML_EDITING_SCOPE_ATTRIBUTE}]`).attr(HTML_EDITING_SCOPE_ATTRIBUTE));
  assert.equal(first.revision.revision.sourceHtml, first.sourceHtml);
  assert.equal(first.revision.compiled.sourceSha256, createHash("sha256").update(first.sourceHtml).digest("hex"));
});

test("derived root protects layout and paint containment without mutating authored inline styles", () => {
  const result = compile(".shared{position:absolute;left:-100px;width:1000%}");
  const root = result.dom.root().children();
  assert.equal(root.length, 1);
  assert.equal(root.attr(HTML_EDITING_SCOPE_ATTRIBUTE)?.length, 64);
  const style = root.attr("style")!;
  for (const declaration of ["contain:layout paint style!important", "overflow:hidden!important",
    "isolation:isolate!important", "position:relative!important", "width:100%!important", "height:100%!important",
    "display:block!important", "overflow-clip-margin:0px!important"])
    assert.ok(style.includes(declaration));
  assert.equal(result.dom("#title_first").attr("style"), undefined);
});

test("pseudo-elements remain outside is() and nested static media/supports retain scoped rules", () => {
  const result = compile("@media (min-width:1px){@supports (display:grid){.shared::before, .shared:after{content:'x'}}}");
  const root = postcss.parse(result.dom("style").text());
  root.walkRules(rule => {
    assert.ok(rule.selectors[0].endsWith(":is(.shared)::before"));
    assert.ok(rule.selectors[1].endsWith(":is(.shared):after"));
    assert.equal(rule.parent?.type, "atrule");
  });
});

test("global layer names and order statements are namespaced consistently across a fragment", () => {
  const result = compile("@LAYER base, theme;@layer base{.shared{color:red}}@layer theme{.shared{color:blue}}");
  const root = postcss.parse(result.dom("style").text());
  const params: string[] = [];
  root.walkAtRules(rule => { if (rule.name.toLowerCase() === "layer") params.push(rule.params); });
  assert.match(params[1], /^cf_[a-f0-9]{64}\.base$/);
  assert.match(params[2], /^cf_[a-f0-9]{64}\.theme$/);
  assert.equal(params[0], `${params[1]}, ${params[2]}`);
});

test("unsupported document selectors, nesting and pseudo-elements fail explicitly instead of losing styles", () => {
  for (const css of ["body{color:red}", "html .shared{color:red}", ":root{--accent:red}",
    ".shared:scope{color:red}", ".shared::part(secret){color:red}",
    ".shared{& p{color:red}}", ".shared{@media all{p{color:red}}}",
    "@layer outer{@layer inner{.shared{color:red}}}"]) {
    assert.throws(() => compile(css), /HTML_EDITING_INVALID_SOURCE/);
  }
});

test("scope derivation is deterministic and cannot be spoofed by source attributes", () => {
  const first = compile(".shared{color:red}");
  assert.deepEqual(first.revision, compile(".shared{color:red}").revision);
  // The shared bootstrap rejects the reserved marker before output scoping.
  const spoofed = `<p id="title" ${HTML_EDITING_SCOPE_ATTRIBUTE}="fake">Original</p>`;
  const { organizationId, documentId, revisionId, documentSha256, clipId } = first.revision.revision.manifest.binding;
  assert.throws(() => prepareInitialHtmlEditingRevision({
    authoritativeAnchor: { organizationId, documentId, revisionId, documentSha256, clipId },
    sourceHtml: spoofed, grantedAssetIds: [], imageSources: new Map(),
    encodedTrustedTemplate: JSON.stringify({ format: "courseforge-html-editable-template-v1", templateId: "template", templateVersion: 1,
      sourceSha256: createHash("sha256").update(spoofed).digest("hex"),
      elements: [{ kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 100, multiline: true }] }),
  }), /HTML_EDITING_INVALID_SOURCE/);
});
