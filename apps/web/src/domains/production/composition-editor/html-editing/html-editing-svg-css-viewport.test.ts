import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import postcss from "postcss";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";
import { createHtmlEditingSvgCssViewportReader, HTML_EDITING_SVG_CSS_VIEWPORT_POLICY as policy } from "./html-editing-svg-css-viewport.server";

const svg = '<svg id="icon" class="icon" width="24" height="24" viewBox="0 0 24 24"><path d="M0 0L24 24"/></svg>';
const tiny = '<svg width="1" height="1" viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>';
const rejects = (html: string, css?: string) => assert.throws(() => parseHtmlEditingStaticSource(html, css), /HTML_EDITING_INVALID_SOURCE/);

test("fixed SVG CSS viewport preserves source and does not acquire dimensions from unrelated HTML subjects", () => {
  const source = `<h1>Heading</h1>${svg}<style>h1{width:8192px;height:8192px}.icon{width:48px;height:48px}</style>`;
  const parsed = parseHtmlEditingStaticSource(source);
  assert.equal(parsed("svg").attr("width"), "24"); assert.equal(parsed("svg").attr("style"), undefined);
  assert.equal(parsed("style").text(), "h1{width:8192px;height:8192px}.icon{width:48px;height:48px}");
  assert.doesNotThrow(() => parseHtmlEditingStaticSource(`${svg}<style>:is(h1){width:8192px;height:8192px}.icon::before{width:8192px}</style>`));
});

test("fixed CSS dimensions cannot amplify a small viewBox via inline, later, nested or contextual styles", () => {
  const declaration = "width:32px;height:32px";
  rejects(tiny.replace('<svg ', `<svg style="${declaration}" `));
  for (const css of [`svg{${declaration}}`, `@media(min-width:1px){svg{${declaration}!important}}`,
    `@supports(display:grid){svg{${declaration}}}`, `@layer a{svg{${declaration}}}`,
    `p,svg{${declaration}}`, `:is(svg){${declaration}}`, `section > svg{${declaration}}`]) {
    rejects(`${tiny}<style>${css}</style>`); rejects(tiny, css);
  }
  rejects(`${tiny}<style>svg{width:32px;width:1px;height:32px;height:1px}</style>`);
});

test("CSS ancestor viewport amplification composes with descendant transforms and siblings remain independent", () => {
  const parent = '<svg class="outer" width="25" height="25" viewBox="0 0 25 25">';
  const css = ".outer{width:100px;height:100px}";
  rejects(`${parent}<g transform="scale(5)"/></svg>`, css);
  assert.doesNotThrow(() => parseHtmlEditingStaticSource(`${parent}<g transform="scale(4)"/><g transform="scale(4)"/></svg>`, css));
  rejects(`${parent}<svg width="25" height="25" viewBox="0 0 25 25"><g transform="scale(5)"/></svg></svg>`, css);
});

test("CSS min sizes, viewport origins and revived zero viewports consume the same envelope", () => {
  rejects(tiny, "svg{min-width:32px;min-height:32px}");
  rejects(`${svg}<style>svg{x:8192px;y:8192px}</style>`);
  rejects(tiny.replace('width="1" height="1"', 'width="0" height="0"'), "svg{width:32px;height:32px}");
  assert.doesNotThrow(() => parseHtmlEditingStaticSource(svg, "svg{x:-2px;y:3px}"));
});

test("known CSS alternatives are checked even when other declarations still require computed authority", () => {
  const fragment = load(svg, {}, false), element = fragment("svg")[0];
  const reader = createHtmlEditingSvgCssViewportReader(fragment, [{root: postcss.parse("svg{width:48px;width:100%;height:48px}")}]);
  assert.equal(reader(element)?.requiresComputedAuthority, true); assert.equal(reader(element)?.fixedBudget?.scale, 2);
  rejects(tiny, "svg{width:32px;width:100%;height:32px;height:auto}");
  const unresolved = createHtmlEditingSvgCssViewportReader(load('<svg viewBox="0 0 24 24"/>', {}, false),
    [{root: postcss.parse("svg{width:100%;height:auto}")}]);
  const relativeFragment = load('<svg viewBox="0 0 24 24"/>', {}, false);
  assert.deepEqual(unresolved(relativeFragment("svg")[0]), undefined); // identities are scoped to the parsed tree
  const scoped = createHtmlEditingSvgCssViewportReader(relativeFragment, [{root: postcss.parse("svg{width:100%;height:auto}")}]);
  assert.deepEqual(scoped(relativeFragment("svg")[0]), {fixedBudget: null, requiresComputedAuthority: true});
});

test("CSS-only fixed dimensions and alignment cancellation cannot evade viewport checks", () => {
  rejects(tiny.replace(' width="1" height="1"', ''), "svg{width:32px;height:32px}");
  const fragment = load('<svg width="1" height="1" viewBox="0 0 1 1"/>', {}, false);
  const evidence = createHtmlEditingSvgCssViewportReader(fragment, [{root: postcss.parse("svg{width:16px;height:16px}")}])(fragment("svg")[0]);
  assert.equal(evidence?.fixedBudget?.scale, 16); assert.ok(evidence!.fixedBudget!.translation > 0);
});

test("selector recursion and aggregate subject work are bounded before matching complex alternatives", () => {
  const nested = ":is(".repeat(policy.maximumSelectorDepth + 1) + "svg" + ")".repeat(policy.maximumSelectorDepth + 1);
  assert.throws(() => parseHtmlEditingStaticSource(svg, `${nested}{width:24px}`), /HTML_EDITING_PAYLOAD_LIMIT/);
  const source = Array.from({length: 200}, () => svg).join("");
  const css = `.${"a".repeat(Math.ceil(policy.maximumSelectorCharacters / 200))}{width:24px}`;
  assert.throws(() => parseHtmlEditingStaticSource(source, css), /HTML_EDITING_PAYLOAD_LIMIT/);
});
