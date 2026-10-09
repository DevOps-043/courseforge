import assert from "node:assert/strict";
import test from "node:test";
import { assertHtmlEditingGeometryDeclaration, assertHtmlEditingSvgGeometry, HTML_EDITING_GEOMETRY_POLICY } from "./html-editing-geometry.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";

test("static layout admits bounded units, logical fields, shorthands and intrinsic sizes", () => {
  for (const [property, value] of [
    ["position", "absolute"], ["width", "100%"], ["height", "8192px"], ["max-inline-size", "none"],
    ["padding", "0 16px 2em"], ["margin-inline-start", "-10px"], ["inset", "auto 0 2rem"],
    ["font-size", "512px"], ["letter-spacing", "-2px"], ["border-radius", "10px 20px / 5px"],
    ["line-height", "1.5"], ["line-height", "24px"],
    ["width", "max-content"], ["opacity", "0.5"], ["color", "var(--accent)"],
  ]) assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration(property, value));
});

test("geometry rejects excessive, nonfinite, indirect and context-dependent dimensions without clamping", () => {
  for (const [property, value] of [
    ["width", "8193px"], ["height", "1e309px"], ["width", "1001%"], ["font-size", "513px"],
    ["font-size", "128em"], ["font-size", "1000%"], ["font", "10000px serif"],
    ["line-height", "1e309"], ["line-height", "5"], ["line-height", "3000px"],
    ["height", "-1px"], ["padding", "-1px"], ["width", "1"], ["width", "100vw"],
    ["width", "calc(1px * 999999999)"], ["height", "var(--size)"], ["width", "inherit"],
    ["inset", "env(safe-area-inset-top)"], ["width", "1px / 2px"], ["gap", "1px 2px 3px 4px 5px"],
    ["position", "fixed"], ["position", "sticky"], ["position", "var(--position)"],
    ["transform", "scale(99999999)"], ["translate", "1e309px"], ["perspective", "1px"],
    ["backdrop-filter", "blur(2px)"], ["zoom", "100"],
  ]) assert.throws(() => assertHtmlEditingGeometryDeclaration(property, value), /HTML_EDITING_INVALID_SOURCE/);
  assert.equal(HTML_EDITING_GEOMETRY_POLICY.maximumPixels, 8192);
});

test("same admission applies to inline and nested stylesheet declarations, including comments and importance", () => {
  for (const declaration of ["width:1e309px", "height:8193px", "position:fi/**/xed", "padding:-1px", "width:var(--secret)"]) {
    for (const source of [`<p style="${declaration}">Text</p>`,
      `<style>@media (min-width:1px){p{${declaration} !important}}</style><p>Text</p>`]) {
      assert.throws(() => parseHtmlEditingStaticSource(source), /HTML_EDITING_INVALID_SOURCE/);
    }
  }
  const source = '<style>p{width:100%;padding:16px}</style><p style="position:relative;left:-12px">Original</p>';
  const parsed = parseHtmlEditingStaticSource(source);
  assert.equal(parsed("p").attr("style"), "position:relative;left:-12px");
});

test("SVG viewport and shape dimensions are independently finite and are not rewritten", () => {
  const original = '<svg viewBox="0 0 1200 675" width="100%" height="675"><rect x="-12" y="0" width="1200" height="675" rx="5"/></svg>';
  const parsed = parseHtmlEditingStaticSource(original);
  assert.equal(parsed("rect").attr("x"), "-12");
  assert.equal(parsed("svg").attr("viewBox"), "0 0 1200 675");
  const invalidAttributes: Record<string, string>[] = [{ viewBox: "0 0 1e309 675" }, { viewBox: "0 0 -1 675" },
    { viewBox: "0 0 1200 0" }, { viewBox: "0 0 8193 675" }, { viewBox: "0 0 1200 675 1" },
    { width: "9000" }, { height: "calc(9999px)" }];
  for (const attributes of invalidAttributes) {
    assert.throws(() => assertHtmlEditingSvgGeometry("svg", attributes), /HTML_EDITING_INVALID_SOURCE/);
  }
  assert.throws(() => parseHtmlEditingStaticSource('<svg><circle r="-1"/></svg>'), /HTML_EDITING_INVALID_SOURCE/);
  assert.throws(() => parseHtmlEditingStaticSource('<svg><line x1="1e309"/></svg>'), /HTML_EDITING_INVALID_SOURCE/);
});

test("effects and SVG presentation attributes cannot bypass CSS geometry admission", () => {
  for (const source of ['<p style="filter:blur(100000px)">Text</p>',
    '<p style="filter:blur(var(--radius))">Text</p>', '<p style="box-shadow:0 0 99999px red">Text</p>',
    '<svg><path stroke-width="99999" d="M0 0L1 1"/></svg>', '<svg><text font-size="99999">Text</text></svg>',
    '<svg><g filter="blur(100000px)"/></svg>',
    '<svg><g transform="scale(99999)"><path d="M0 0L1 1"/></g></svg>',
    '<svg><g transform="matrix(1 0 0 1 99999 0)"/></svg>',
    '<svg><path d="M0 0L1e309 2"/></svg>', '<svg><polygon points="0,0 99999,2"/></svg>']) {
    assert.throws(() => parseHtmlEditingStaticSource(source), /HTML_EDITING_INVALID_SOURCE/);
  }
  assert.doesNotThrow(() => parseHtmlEditingStaticSource('<p style="filter:blur(4px);text-shadow:none">Text</p>'));
});

test("SVG finite transforms preserve native chart rotation and reject malformed or unsupported operations", () => {
  const original = '<svg><g transform="translate(12 -3) scale(2) rotate(-90 190 188)"><path d="M0 0L20 20Z"/></g></svg>';
  assert.equal(parseHtmlEditingStaticSource(original)("g").attr("transform"), "translate(12 -3) scale(2) rotate(-90 190 188)");
  for (const transform of ["scale(1e309)", "rotate(361)", "translate(NaN 0)", "rotate(2 3)",
    "skewX(45)", "scale(var(--scale))", "scale(2) garbage", "translate(1)".repeat(9)]) {
    assert.throws(() => assertHtmlEditingSvgGeometry("g", { transform }), /HTML_EDITING_INVALID_SOURCE/);
  }
});

test("SVG path and point numeric complexity is bounded without rewriting source commands", () => {
  assert.doesNotThrow(() => assertHtmlEditingSvgGeometry("path", { d: "M0 0L20 20Z" }));
  assert.throws(() => assertHtmlEditingSvgGeometry("polyline", {
    points: "0 ".repeat(HTML_EDITING_GEOMETRY_POLICY.maximumSvgNumericTokens + 1),
  }), /HTML_EDITING_INVALID_SOURCE/);
});

test("transform envelope bounds composition within one list and across SVG ancestors", () => {
  for (const source of ['<svg><g transform="scale(16) scale(16)"/></svg>',
    '<svg><g transform="scale(16)"><g transform="scale(2)"/></g></svg>',
    '<svg><g transform="scale(16)"><g transform="translate(600)"/></g></svg>',
    '<svg><g transform="translate(5000)"><g transform="translate(5000)"/></g></svg>',
    '<svg><g transform="scale(16)"><svg><g transform="scale(16)"/></svg></g></svg>']) {
    assert.throws(() => parseHtmlEditingStaticSource(source), /HTML_EDITING_INVALID_SOURCE/);
  }
  assert.doesNotThrow(() => parseHtmlEditingStaticSource('<svg><g transform="scale(4)"><g transform="scale(4) translate(10)"/></g></svg>'));
});

test("sibling envelopes are independent and shrinking or cancelling transforms do not recover budget", () => {
  assert.doesNotThrow(() => parseHtmlEditingStaticSource('<svg><g transform="scale(16)"/><g transform="scale(16)"/></svg>'));
  assert.throws(() => parseHtmlEditingStaticSource('<svg><g transform="scale(16) scale(.01) scale(16)"/></svg>'), /HTML_EDITING_INVALID_SOURCE/);
  assert.throws(() => parseHtmlEditingStaticSource('<svg><g transform="translate(5000) translate(-5000)"/></svg>'), /HTML_EDITING_INVALID_SOURCE/);
  assert.throws(() => parseHtmlEditingStaticSource('<svg><g transform="scale(16)"><defs><linearGradient gradientTransform="scale(2)"/></defs></g></svg>'), /HTML_EDITING_INVALID_SOURCE/);
});
