import assert from "node:assert/strict";
import test from "node:test";
import { HTML_EDITING_LIMITS } from "./html-editing.contract";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";
import { HtmlEditingValidationError } from "./html-editing-validation";

function rejects(source: string, code: HtmlEditingValidationError["code"]) {
  assert.throws(() => parseHtmlEditingStaticSource(source),
    error => error instanceof HtmlEditingValidationError && error.code === code);
}

test("static source admits finite nested layout and preserves source input", () => {
  const source = '<section id="theme"><style>@media (min-width: 1px){#title{color:red}}</style><h1 id="title" style="font-size:24px">Título 🧭</h1></section>';
  const fragment = parseHtmlEditingStaticSource(source);
  assert.equal(fragment("#title").text(), "Título 🧭");
  assert.equal(fragment("#title").attr("style"), "font-size:24px");
  assert.ok(source.includes("Título 🧭"));
});

test("static source bounds HTML bytes before parsing, including multibyte text", () => {
  rejects("a".repeat(HTML_EDITING_LIMITS.sourceBytes + 1), "PAYLOAD_LIMIT");
  rejects("é".repeat(Math.floor(HTML_EDITING_LIMITS.sourceBytes / 2) + 1), "PAYLOAD_LIMIT");
});

test("DOM depth boundary is finite and text/comment nodes count toward complexity", () => {
  const atBoundary = "<div>".repeat(HTML_EDITING_LIMITS.sourceDepth) + "</div>".repeat(HTML_EDITING_LIMITS.sourceDepth);
  assert.equal(parseHtmlEditingStaticSource(atBoundary)("div").length, HTML_EDITING_LIMITS.sourceDepth);
  rejects(`<div>${atBoundary}</div>`, "PAYLOAD_LIMIT");
  assert.equal(parseHtmlEditingStaticSource("<span></span>".repeat(HTML_EDITING_LIMITS.sourceNodes))("span").length,
    HTML_EDITING_LIMITS.sourceNodes);
  rejects("<span>text<!--comment--></span>".repeat(Math.floor(HTML_EDITING_LIMITS.sourceNodes / 3) + 1), "PAYLOAD_LIMIT");
});

test("CSS cannot own an autonomous animation clock in inline or style declarations", () => {
  for (const declaration of ["animation:spin 1s infinite", "animation-name:spin", "animation-play-state:paused",
    "transition:all 1s", "transition-duration:2s", "-webkit-animation:spin 1s", "-moz-transition:all 1s",
    "ani/**/mation:spin 1s", "-web/**/kit-animation:spin 1s", "anima\\74 ion:spin 1s"]) {
    rejects(`<span style="${declaration}">Static</span>`, "INVALID_SOURCE");
    rejects(`<style>span{${declaration}}</style>`, "INVALID_SOURCE");
  }
  for (const rule of ["@keyframes spin{from{opacity:0}to{opacity:1}}", "@-webkit-keyframes spin{to{opacity:1}}",
    "@import url(https://foreign.invalid/style.css);", "@font-face{font-family:foreign;src:url(remote)}"]) {
    rejects(`<style>${rule}</style>`, "INVALID_SOURCE");
  }
});

test("CSS interactive selectors cannot vary static output by hover, focus, navigation or escaped selectors", () => {
  for (const selector of ["span:hover", "span:focus", "span:focus-within", "span:focus-visible", "span:active",
    "a:visited", "span:target", "input:checked", "span:h/**/over", "span:h\\6f ver"]) {
    rejects(`<style>${selector}{opacity:0}</style>`, "INVALID_SOURCE");
  }
  assert.ok(parseHtmlEditingStaticSource('<style>span:nth-child(2){color:red}</style><span>Static</span>')("span").length);
});

test("CSS AST budget is cumulative across style blocks and inline attributes", () => {
  const rules = ".a{color:red}".repeat(Math.floor(HTML_EDITING_LIMITS.cssNodes / 2) + 1);
  rejects(`<style>${rules}</style>`, "PAYLOAD_LIMIT");
  const chunk = ".a{color:red}".repeat(Math.floor(HTML_EDITING_LIMITS.cssNodes / 4) + 1);
  rejects(`<style>${chunk}</style><style>${chunk}</style>`, "PAYLOAD_LIMIT");
  const nested = "@media all{".repeat(HTML_EDITING_LIMITS.cssDepth) + ".a{color:red}" + "}".repeat(HTML_EDITING_LIMITS.cssDepth);
  rejects(`<style>${nested}</style>`, "PAYLOAD_LIMIT");
});

test("static media rules cannot depend on personal preferences or interactive device capabilities", () => {
  for (const condition of ["prefers-color-scheme: dark", "prefers-reduced-motion: reduce", "prefers-contrast: more",
    "hover: hover", "any-pointer: fine", "forced-colors: active", "dynamic-range: high", "prefers-/**/color-scheme: dark",
    "prefers-color-scheme\\3a dark"]) {
    rejects(`<style>@media (${condition}){span{color:red}}</style>`, "INVALID_SOURCE");
  }
});

test("malformed CSS yields safe validation codes rather than parser internals or supplied content", () => {
  assert.throws(() => parseHtmlEditingStaticSource('<style>.private-secret{color:</style>'), error =>
    error instanceof HtmlEditingValidationError && error.code === "INVALID_SOURCE" && !error.message.includes("private-secret"));
});
