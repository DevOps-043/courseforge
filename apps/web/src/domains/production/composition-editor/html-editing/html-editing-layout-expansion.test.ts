import assert from "node:assert/strict";
import test from "node:test";
import { assertHtmlEditingGeometryDeclaration } from "./html-editing-geometry.server";
import { HTML_EDITING_LAYOUT_EXPANSION_POLICY } from "./html-editing-layout-expansion.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";

test("grid explicit tracks count expanded repetitions and retain ordinary bounded layouts", () => {
  for (const value of ["none", "1fr 2fr", "repeat(128, 1fr)", "repeat(64, 1fr 20px)",
    "[start] 10px repeat(3, [item] minmax(0,1fr)) [end]", "fit-content(200px) auto min-content"]) {
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("grid-template-columns", value));
  }
  for (const value of ["repeat(129,1fr)", "repeat(65,1fr 1fr)", "1fr repeat(128,1fr)",
    "repeat(1000000000,1px)", "repeat(auto-fill,1px)", "repeat(auto-fit,1px)", "repeat(0,1fr)",
    "repeat(2,repeat(2,1fr))", "minmax(1fr,2fr)", "minmax(0,1fr,2fr)", "fit-content(auto)",
    "var(--tracks)", "subgrid", "1e309fr", "129fr", "minmax(0,999999px)", "repeat(1,)", "repeat(,1fr)"]) {
    assert.throws(() => assertHtmlEditingGeometryDeclaration("grid-template-rows", value), /INVALID_SOURCE/);
  }
  assert.throws(() => assertHtmlEditingGeometryDeclaration("grid-auto-columns", "repeat(2,1fr)"), /INVALID_SOURCE/);
  assert.throws(() => assertHtmlEditingGeometryDeclaration("grid", "auto-flow / repeat(999999,1px)"), /INVALID_SOURCE/);
});

test("grid placements bound numeric lines/spans including shorthand and negative indexes", () => {
  for (const value of ["auto", "1 / -1", "span 128", "header", "name 2 / span 3 name"])
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("grid-column", value));
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("grid-area", "1 / 2 / 3 / 4"));
  for (const value of ["129", "-129", "0", "span -1", "span", "span 1000000", "var(--index)", "1 2", "span span 1", "1 / / 2"])
    assert.throws(() => assertHtmlEditingGeometryDeclaration("grid-row", value), /INVALID_SOURCE/);
  assert.throws(() => assertHtmlEditingGeometryDeclaration("grid-row-start", "1 / 2"), /INVALID_SOURCE/);
});

test("named areas and repeated line names have independent expansion budgets", () => {
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("grid-template-areas", '"header header" "nav body"'));
  for (const value of ['"a b" "c"', '""', '"a b" trailing', '"a '.repeat(129) + '"'])
    assert.throws(() => assertHtmlEditingGeometryDeclaration("grid-template-areas", value), /INVALID_SOURCE/);
  const row = '"' + Array(64).fill(".").join(" ") + '"';
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("grid-template-areas", Array(64).fill(row).join(" ")));
  assert.throws(() => assertHtmlEditingGeometryDeclaration("grid-template-areas", Array(65).fill(row).join(" ")), /INVALID_SOURCE/);
  const names = Array.from({ length: 16 }, (_, index) => `line${index}`).join(" ");
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("grid-template-columns", `repeat(128,[${names}] 1fr)`));
  assert.throws(() => assertHtmlEditingGeometryDeclaration("grid-template-columns", `[extra] repeat(128,[${names}] 1fr)`), /INVALID_SOURCE/);
  assert.equal(HTML_EDITING_LAYOUT_EXPANSION_POLICY.maximumExpandedLineNames, 2048);
});

test("multicolumn requested counts and widths are finite and bounded without claiming fragmentation limits", () => {
  for (const [property, value] of [["column-count", "32"], ["column-count", "auto"], ["columns", "200px 3"],
    ["columns", "3 auto"], ["column-width", "8192px"], ["-webkit-column-count", "2"]])
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration(property, value));
  for (const [property, value] of [["column-count", "33"], ["column-count", "0"], ["column-count", "1e9"],
    ["columns", "1px 1000000"], ["columns", "2 3"], ["column-width", "0px"], ["column-width", "8193px"],
    ["columns", "var(--columns)"], ["column-count", "inherit"], ["column-width", "1vw"], ["column-width", ".001px"],
    ["column-rule-width", "9000px"], ["column-rule", "9000px solid red"], ["-webkit-column-rule", "9000px solid red"]])
    assert.throws(() => assertHtmlEditingGeometryDeclaration(property, value), /INVALID_SOURCE/);
});

test("same expansion guards run for inline and nested CSS, preserving accepted source", () => {
  for (const declaration of ["grid-template-columns:repeat(1000000,1px)", "grid-column:1000000", "columns:1px 1000000",
    "grid-template-columns:rep/**/eat(129,1fr)", "grid-gap:9000px", "grid-row-gap:9000px"]) {
    for (const html of [`<p style="${declaration}">Text</p>`,
      `<style>@media(min-width:1px){p{${declaration}!important}}</style><p>Text</p>`])
      assert.throws(() => parseHtmlEditingStaticSource(html), /INVALID_SOURCE/);
  }
  const style = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-gap:16px";
  assert.equal(parseHtmlEditingStaticSource(`<p style="${style}">Text</p>`)("p").attr("style"), style);
});
