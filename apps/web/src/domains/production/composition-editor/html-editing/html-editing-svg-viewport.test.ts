import assert from "node:assert/strict";
import test from "node:test";
import { readHtmlEditingSvgViewportBudget } from "./html-editing-svg-viewport.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";

test("explicit attribute viewport implements meet, slice, none and alignment", () => {
  const viewport = { viewBox: "0 0 100 100", width: "200", height: "100px" };
  assert.deepEqual(readHtmlEditingSvgViewportBudget(viewport), { scale: 1, translation: 50 });
  assert.deepEqual(readHtmlEditingSvgViewportBudget({ ...viewport, preserveAspectRatio: "none" }), { scale: 2, translation: 0 });
  assert.deepEqual(readHtmlEditingSvgViewportBudget({ ...viewport, preserveAspectRatio: "xMaxYMax slice" }), { scale: 2, translation: 100 });
  assert.deepEqual(readHtmlEditingSvgViewportBudget({ ...viewport, preserveAspectRatio: "xMinYMin meet" }), { scale: 1, translation: 0 });
});

test("viewport origins, viewBox origin and nested scale consume ancestor envelope", () => {
  assert.deepEqual(readHtmlEditingSvgViewportBudget({ viewBox: "10 20 100 100", width: "100", height: "100", x: "13", y: "24" }),
    { scale: 1, translation: 5 });
  for (const source of ['<svg width="100" height="100" viewBox="0 0 1 1"/>',
    '<svg width="100" height="100" viewBox="0 0 10 10"><svg width="100" height="100" viewBox="0 0 10 10"/></svg>',
    '<svg width="100" height="100" viewBox="0 0 10 10"><g transform="scale(2)"/></svg>',
    '<svg width="100" height="100" viewBox="8192 0 10 10"/>']) {
    assert.throws(() => parseHtmlEditingStaticSource(source), /HTML_EDITING_INVALID_SOURCE/);
  }
});

test("ordinary fixed-size icons and charts preserve viewport attributes", () => {
  const source = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M0 0L24 24"/></svg>';
  const parsed = parseHtmlEditingStaticSource(source);
  assert.equal(parsed("svg").attr("viewBox"), "0 0 24 24");
  assert.equal(parsed("svg").attr("width"), "24");
  assert.doesNotThrow(() => parseHtmlEditingStaticSource('<svg width="640" height="360" viewBox="0 0 640 360"/>'));
  assert.doesNotThrow(() => parseHtmlEditingStaticSource('<svg width="0" height="24" viewBox="0 0 24 24"/>'));
});

test("relative, absent and CSS-dependent viewport dimensions are explicitly unproven", () => {
  const viewports: Record<string, string>[] = [{ viewBox: "0 0 24 24" }, { viewBox: "0 0 24 24", width: "100%", height: "24" },
    { viewBox: "0 0 24 24", width: "24", height: "2em" }, { width: "24", height: "24" }];
  for (const viewport of viewports) {
    assert.equal(readHtmlEditingSvgViewportBudget(viewport), null);
  }
});

test("viewBox inverse overflow and malformed alignment fail safely even without explicit sizing", () => {
  const viewports: Record<string, string>[] = [{ viewBox: "0 0 1e-309 1" }, { viewBox: "8192 0 1e-308 1" },
    { viewBox: "0 0 NaN 1" }, { viewBox: "0 0 1 1 1" }, { viewBox: "0 0 0 1" },
    { preserveAspectRatio: "invalid" }, { preserveAspectRatio: "xMidYMid garbage" }];
  for (const viewport of viewports) {
    assert.throws(() => readHtmlEditingSvgViewportBudget(viewport), /HTML_EDITING_INVALID_SOURCE/);
  }
});
