import assert from "node:assert/strict";
import test from "node:test";
import { assertHtmlEditingGeometryDeclaration, HTML_EDITING_GEOMETRY_POLICY } from "./html-editing-geometry.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";

test("SVG geometry CSS longhands use bounded single values rather than unchecked declarations", () => {
  for (const property of ["x", "y", "cx", "cy", "r", "rx", "ry", "stroke-width", "stroke-dashoffset"]) {
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration(property, "24"));
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration(property, "2px"));
    for (const value of ["9000", "1e309", "var(--unbounded)", "calc(1px * 99999)", "10px 20px", "inherit"])
      assert.throws(() => assertHtmlEditingGeometryDeclaration(property, value), /HTML_EDITING_INVALID_SOURCE/);
  }
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("rx", "auto"));
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("x", "-12px"));
  assert.throws(() => assertHtmlEditingGeometryDeclaration("r", "auto"), /HTML_EDITING_INVALID_SOURCE/);
  assert.throws(() => assertHtmlEditingGeometryDeclaration("r", "-1"), /HTML_EDITING_INVALID_SOURCE/);
});

test("stylesheet and inline geometry cannot override bounded SVG attributes with excessive values", () => {
  for (const declaration of ["cx:99999", "r:var(--radius)", "stroke-width:99999", "stroke-dashoffset:1e309",
    "stroke-miterlimit:99999", "stroke-dasharray:1 -2"]) {
    for (const source of [`<svg><circle r="4" style="${declaration}"/></svg>`,
      `<style>@media(min-width:1px){circle{${declaration}!important}}</style><svg><circle r="4"/></svg>`])
      assert.throws(() => parseHtmlEditingStaticSource(source), /HTML_EDITING_INVALID_SOURCE/);
  }
});

test("dash arrays and miter limits have bounded grammar and identical attribute/CSS admission", () => {
  for (const value of ["1, 2px, 3", "0 2 0 2", "none"])
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("stroke-dasharray", value));
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("stroke-dasharray",
    "1 ".repeat(HTML_EDITING_GEOMETRY_POLICY.maximumSvgDashValues).trim()));
  for (const value of ["1", String(HTML_EDITING_GEOMETRY_POLICY.maximumStrokeMiterLimit)])
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("stroke-miterlimit", value));
  for (const value of ["", "1,,2", ",1", "1,", "var(--dash)", "-1 2", "99999 2", "NaN 2",
    "1 ".repeat(HTML_EDITING_GEOMETRY_POLICY.maximumSvgDashValues + 1)]) {
    assert.throws(() => assertHtmlEditingGeometryDeclaration("stroke-dasharray", value), /HTML_EDITING_INVALID_SOURCE/);
    assert.throws(() => parseHtmlEditingStaticSource(`<svg><path d="M0 0L1 1" stroke-dasharray="${value}"/></svg>`), /HTML_EDITING_INVALID_SOURCE/);
  }
  for (const value of ["0", "-1", "17", "1e309", "var(--miter)"])
    assert.throws(() => parseHtmlEditingStaticSource(`<svg><path d="M0 0L1 1" stroke-miterlimit="${value}"/></svg>`), /HTML_EDITING_INVALID_SOURCE/);
});

test("ordinary chart strokes preserve source spelling and remain accepted", () => {
  const source = '<svg><circle cx="190" cy="188" r="84" stroke-width="30" stroke-dasharray="120 527.78" transform="rotate(-90 190 188)"/><path d="M0 0L2 2" style="stroke-width:5;stroke-miterlimit:4;stroke-dashoffset:-2"/></svg>';
  const parsed = parseHtmlEditingStaticSource(source);
  assert.equal(parsed("circle").attr("stroke-dasharray"), "120 527.78");
  assert.equal(parsed("path").attr("style"), "stroke-width:5;stroke-miterlimit:4;stroke-dashoffset:-2");
});
