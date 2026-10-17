import assert from "node:assert/strict";
import test from "node:test";
import { assertHtmlEditingGeometryDeclaration } from "./html-editing-geometry.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";

test("CSS motion-path cannot add an independent transform via longhands, shorthand or legacy prefixes", () => {
  for (const [property, value] of [["offset-path", "path('M0 0L999999 0')"], ["offset", "path('M0 0L1 1') 100000px"],
    ["offset-distance", "8192px"], ["offset-position", "100000px 0"], ["offset-anchor", "10000px 0"],
    ["offset-rotate", "90deg"], ["motion-path", "ray(45deg)"], ["-webkit-offset-path", "circle(999999px)"],
    ["offset-path", "var(--path)"], ["offset-path", "inherit"], ["offset-unknown", "none"]]) {
    assert.throws(() => assertHtmlEditingGeometryDeclaration(property, value), /INVALID_SOURCE/);
    for (const html of [`<p style="${property}:${value}">Text</p>`,
      `<style>@media(min-width:1px){p{${property}:${value}!important}}</style><p>Text</p>`])
      assert.throws(() => parseHtmlEditingStaticSource(html), /INVALID_SOURCE/);
  }
  for (const [property, value] of [["offset", "none"], ["offset-path", "none"], ["offset-distance", "0%"],
    ["offset-position", "normal"], ["offset-anchor", "auto"], ["offset-rotate", "auto"], ["offset-rotate", "0deg"]])
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration(property, value));
});

test("border and outline shorthands require one explicit finite pixel width without indirect expansion", () => {
  for (const property of ["border", "border-top", "border-inline", "border-inline-start", "border-block-end", "outline"]) {
    for (const value of ["8193px solid red", "1e309px solid red", "-1px solid red", "128em solid red",
      "thin solid red", "solid var(--width)", "1px solid var(--color)", "1px solid rgb(0,0,0)",
      "inherit", "1px 2px solid", "1px solid dashed", "1px red blue", "1px / 2px"]) {
      assert.throws(() => assertHtmlEditingGeometryDeclaration(property, value), /INVALID_SOURCE/);
    }
    for (const value of ["1px solid red", "solid #abc 8192px", "0", "0px", "none", "hidden", "1px currentcolor"])
      assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration(property, value));
  }
});

test("logical border widths, radii and outline width/offset use the existing length policy", () => {
  for (const property of ["border-inline-width", "border-inline-start-width", "border-block-end-width",
    "outline-width", "border-start-start-radius", "border-end-end-radius"]) {
    for (const value of ["8193px", "1e309px", "-1px", "var(--size)", "calc(8192px * 2)"])
      assert.throws(() => assertHtmlEditingGeometryDeclaration(property, value), /INVALID_SOURCE/);
    assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration(property, "8192px"));
  }
  assert.doesNotThrow(() => assertHtmlEditingGeometryDeclaration("outline-offset", "-8192px"));
  assert.throws(() => assertHtmlEditingGeometryDeclaration("outline-offset", "-8193px"), /INVALID_SOURCE/);
});

test("layout sink policy applies to inline and nested stylesheets without rewriting supported source", () => {
  for (const declaration of ["border:9000px solid red", "border-inline-start-width:9000px", "outline:9000px solid red",
    "outline-offset:9000px", "border-end-end-radius:9000px", "offset-path:pa/**/th('M0 0L1 1')"]) {
    for (const html of [`<p style="${declaration}">Text</p>`,
      `<style>@supports(display:grid){p{${declaration}!important}}</style><p>Text</p>`])
      assert.throws(() => parseHtmlEditingStaticSource(html), /INVALID_SOURCE/);
  }
  const style = "border:1px solid #123;outline:none;outline-offset:-2px;offset-path:none";
  assert.equal(parseHtmlEditingStaticSource(`<p style="${style}">Text</p>`)("p").attr("style"), style);
});
