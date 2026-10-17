import assert from "node:assert/strict";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {setNativeTextPaintSuppression} from "../qa/composition-text-paint-mask-capture";

function fixture(change?: "style" | "bounds" | "text" | "children") {
  let installed = false;
  const originalChild = {}, replacementChild = {};
  const target = {
    namespaceURI: "http://www.w3.org/1999/xhtml", matches: () => true, querySelectorAll: () => [],
    get textContent() {return installed && change === "text" ? "Changed" : "Caption";},
    get childNodes() {return [installed && change === "children" ? replacementChild : originalChild];},
    getBoundingClientRect: () => ({left: 0, top: 0, right: installed && change === "bounds" ? 11 : 10, bottom: 10}),
  };
  const styles: Array<{textContent: string}> = [];
  const environment = {CSS: {escape: (id: string) => id}, document: {
    getElementById: () => null, querySelectorAll: () => [target],
    createElement: () => ({dataset: {}, textContent: ""}),
    head: {appendChild: (style: {textContent: string}) => {styles.push(style); installed = true;}},
  }, getComputedStyle: () => Object.assign(["color", "background-color", "border-top-color", "font-size",
    "-webkit-text-fill-color", "-webkit-text-stroke-color", "text-shadow", "caret-color"], {
    getPropertyValue: (name: string): string => name === "background-color" && installed && change === "style"
      ? "transparent" : name === "font-size" ? "24px" : "rgb(255,255,255)",
    webkitTextFillColor: installed ? "rgba(0,0,0,0)" : "rgb(255,255,255)",
    webkitTextStrokeColor: installed ? "rgba(0,0,0,0)" : "rgb(255,255,255)", textShadow: "none",
  })};
  return {environment, styles, target};
}
const execute = (state: ReturnType<typeof fixture>, maximumNodes = 4096) => runInNewContext(
  `(${setNativeTextPaintSuppression.toString()})(["caption"],"owned",${maximumNodes})`, state.environment);

test("native suppression leaves color/currentColor paint intact and is self-contained in CDP", () => {
  const state = fixture();
  assert.equal(execute(state), true);
  assert.match(state.styles[0]!.textContent, /-webkit-text-fill-color:transparent/);
  assert.ok(!state.styles[0]!.textContent.includes("{color:"));
});

test("non-text computed style, geometry, text or child identity drift rejects the pair", () => {
  for (const change of ["style", "bounds", "text", "children"] as const)
    assert.throws(() => execute(fixture(change)), /NON_TEXT_CHANGE/);
});

test("root quota, ambiguous IDs and non-HTML targets reject before DOM mutation", () => {
  const limited = fixture();
  assert.throws(() => execute(limited, 0), /TARGET_LIMIT/);
  assert.equal(limited.styles.length, 0);
  const duplicate = fixture();
  duplicate.environment.document.querySelectorAll = () => [duplicate.target, duplicate.target];
  assert.throws(() => execute(duplicate), /TARGET_INVALID/);
  assert.equal(duplicate.styles.length, 0);
  const svg = fixture(); svg.target.namespaceURI = "http://www.w3.org/2000/svg";
  assert.throws(() => execute(svg), /TARGET_UNSUPPORTED/);
  assert.equal(svg.styles.length, 0);
});

test("oversized computed-style snapshots reject before installing suppression", () => {
  const state = fixture(), original = state.environment.getComputedStyle;
  state.environment.getComputedStyle = () => {
    const computed = original(); computed.getPropertyValue = () => "x".repeat(8193); return computed;
  };
  assert.throws(() => execute(state), /STYLE_LIMIT/);
  assert.equal(state.styles.length, 0);
});
