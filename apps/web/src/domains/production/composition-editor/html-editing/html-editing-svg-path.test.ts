import assert from "node:assert/strict";
import test from "node:test";
import { assertHtmlEditingSvgPath } from "./html-editing-svg-path.server";
import { parseHtmlEditingStaticSource } from "./html-editing-static-source.server";

const limits = { maximumMagnitude: 8192, maximumNumericTokens: 4096 };
const rejects = (path: string) => assert.throws(() => assertHtmlEditingSvgPath(path, limits), /HTML_EDITING_INVALID_SOURCE/);

test("complete static path commands, exponent notation and source bytes are preserved", () => {
  for (const path of ["", "M0 0L20 20Z", "m10,10 20,20 h10 v-2 z m2 3",
    "M1e2-2e1 C10 20 30 40 50 60 S70 80 90 100 Q80 90 70 80 T60 70",
    "M100 100 a20 30 45 0 1 40 10", "M0 0 A0 30 0 0 1 100 100"])
    assert.doesNotThrow(() => assertHtmlEditingSvgPath(path, limits));
  const path = "M10 20 l3 4z";
  assert.equal(parseHtmlEditingStaticSource(`<svg><path d="${path}"/></svg>`)("path").attr("d"), path);
});

test("relative endpoints, controls and implicit lineto cannot accumulate outside bounds", () => {
  for (const path of ["M8000 0 l200 0", "M0 0 " + "l100 0 ".repeat(83),
    "m8000 0 200 0", "M8000 0 h200", "M0 8000 v200", "M8000 0 c200 0 0 0 -1 0",
    "M0 8000 q0 200 0 -1"] ) rejects(path);
});

test("smooth curve reflections are bounded and reset after unrelated commands", () => {
  rejects("M0 0 C0 0 -8000 0 8000 0 S0 0 1 1");
  rejects("M0 0 Q-8000 0 8000 0 T1 1");
  assert.doesNotThrow(() => assertHtmlEditingSvgPath("M0 0 Q-8000 0 8000 0 L0 0 T1 1", limits));
  assert.doesNotThrow(() => assertHtmlEditingSvgPath("M8000 0 l100 0 z l100 0", limits));
});

test("arc radius correction and conservative extent prevent small-radius amplification", () => {
  rejects("M0 0 A.001 8000 0 0 1 1000 0");
  rejects("M8000 0 a200 200 45 1 0 1 1");
  rejects("M0 0 A1e-309 100 45 0 1 100 100");
  assert.doesNotThrow(() => assertHtmlEditingSvgPath("M100 100 A20 20 0 1 1 140 100", limits));
});

test("unsupported commands, truncated groups, invalid flags and numeric spelling fail closed", () => {
  for (const path of ["L0 0", "M0", "M0 0 L1", "M0 0 R1 2", "M0 0 LNaN 2", "M0 0 L1e309 0",
    "M0 0 A-1 2 0 0 1 3 4", "M0 0 A1 2 0 2 1 3 4", "M0 0 A1 2 0 0.0 1 3 4",
    "M0 0 A1 2 0 01 3 4", "M0 0,,L1 1", "M0 0,", "M0 0 Z 1 2", "M0 0 C1 2 3 4 5Z"] ) rejects(path);
});

test("token complexity limit applies to complete valid repeated groups", () => {
  assert.doesNotThrow(() => assertHtmlEditingSvgPath("M0 0 " + "l0 0 ".repeat(2047), limits));
  rejects("M0 0 " + "l0 0 ".repeat(2048));
  rejects("M0 0" + "Z".repeat(4096));
});

test("CSS cannot replace a validated path attribute with unvalidated geometry", () => {
  for (const source of ['<svg><path d="M0 0L1 1" style="d:path(\'M0 0l8000 0l8000 0\')"/></svg>',
    '<style>path{d:path("M0 0l8000 0l8000 0")}</style><svg><path d="M0 0L1 1"/></svg>']) {
    assert.throws(() => parseHtmlEditingStaticSource(source), /HTML_EDITING_INVALID_SOURCE/);
  }
  assert.doesNotThrow(() => parseHtmlEditingStaticSource('<svg><path d="M0 0L1 1" style="d:none"/></svg>'));
});
