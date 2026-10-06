import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { captureDeckTextPaintPair, setDeckTextPaintSuppression } from "../qa/composition-deck-text-paint-capture";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";

function domFixture(changeBackground = false, changeBounds = false) {
  let suppressed = false;
  const target = {namespaceURI: "http://www.w3.org/1999/xhtml", childNodes: [], textContent: "Deck", querySelectorAll: () => [],
    getBoundingClientRect: () => ({left: 0, top: 0, right: suppressed && changeBounds ? 101 : 100, bottom: 50})};
  const styles: Array<{textContent: string}> = [];
  const environment = {CSS: {escape: (id: string) => id}, document: {
    getElementById: () => null, querySelectorAll: () => [{querySelectorAll: () => [target]}],
    createElement: () => ({dataset: {}, textContent: ""}), head: {appendChild: (style: {textContent: string}) => {styles.push(style); suppressed = true;}},
  }, getComputedStyle: () => {
    const names = ["color", "background-color", "font-size", "-webkit-text-fill-color", "-webkit-text-stroke-color", "text-shadow", "caret-color"];
    const properties: Record<string, string> = {color: "rgb(255,255,255)", "background-color": suppressed && changeBackground ? "rgba(0,0,0,0)" : "rgb(255,255,255)", "font-size": "48px"};
    return Object.assign(names, {getPropertyValue: (name: string) => properties[name] ?? "",
      webkitTextFillColor: suppressed ? "rgba(0,0,0,0)" : "rgb(255,255,255)",
      webkitTextStrokeColor: suppressed ? "rgba(0,0,0,0)" : "rgb(255,255,255)", textShadow: "none"});
  }};
  return {environment, styles};
}

test("deck suppression preserves color/currentColor surfaces, text, children, geometry and other computed styles", () => {
  const state = domFixture();
  assert.equal(runInNewContext(`(${setDeckTextPaintSuppression.toString()})(["deck"],"owned",4096)`, state.environment), true);
  assert.match(state.styles[0]!.textContent, /-webkit-text-fill-color:transparent/);
  assert.match(state.styles[0]!.textContent, /#deck \.deck-shell > \.deck-stage > \.slide/);
  assert.ok(!state.styles[0]!.textContent.includes("{color:"));
});

test("non-text style or geometry changes reject suppression instead of being misclassified as text paint", () => {
  for (const state of [domFixture(true), domFixture(false, true)])
    assert.throws(() => runInNewContext(`(${setDeckTextPaintSuppression.toString()})(["deck"],"owned",4096)`, state.environment), /NON_TEXT_CHANGE/);
  const limited = domFixture();
  assert.throws(() => runInNewContext(`(${setDeckTextPaintSuppression.toString()})(["deck"],"owned",0)`, limited.environment), /TARGET_LIMIT/);
  assert.equal(limited.styles.length, 0);
});

test("oversized computed CSS and non-HTML targets fail before installing a stylesheet", () => {
  const oversized = domFixture(), original = oversized.environment.getComputedStyle;
  oversized.environment.getComputedStyle = () => {
    const computed = original(); computed.getPropertyValue = () => "x".repeat(8193); return computed;
  };
  assert.throws(() => runInNewContext(`(${setDeckTextPaintSuppression.toString()})(["deck"],"owned",4096)`, oversized.environment), /STYLE_LIMIT/);
  assert.equal(oversized.styles.length, 0);
  const svg = domFixture();
  svg.environment.document.querySelectorAll()[0]!.querySelectorAll()[0]!.namespaceURI = "http://www.w3.org/2000/svg";
  assert.throws(() => runInNewContext(`(${setDeckTextPaintSuppression.toString()})(["deck"],"owned",4096)`, svg.environment), /TARGET_UNSUPPORTED/);
  assert.equal(svg.styles.length, 0);
});

test("restored deck pair uses shared cleanup, bounds PNG bytes and never retains provider messages", async () => {
  const calls: string[] = [];
  const client = {send: async (_method: string, params: {expression: string}) => {
    calls.push(params.expression.includes("setDeckTextPaintSuppression") ? "deck-suppress" : "restore");
    return {result: {value: true}};
  }} as unknown as CompositionQaCdpClient;
  const painted = Buffer.from("painted"), suppressed = Buffer.from("suppressed"); let count = 0;
  const pair = await captureDeckTextPaintPair(client, ["deck"], painted, async () => count++ === 0 ? suppressed : painted);
  assert.deepEqual(calls, ["deck-suppress", "restore"]);
  assert.equal(pair.suppressedPngSha256, createHash("sha256").update(suppressed).digest("hex"));
  assert.equal(pair.scope, "JOINT_DECK_TEXT_FILL_DELTA_NOT_PER_NODE_CAUSALITY");
  await assert.rejects(captureDeckTextPaintPair(client, ["deck", "deck"], painted), /CAPTURE_INVALID/);
});

test("failed deck suppression still restores and a changed restored PNG rejects success", async () => {
  for (const failSuppression of [true, false]) {
    const calls: string[] = [];
    const client = {send: async (_method: string, params: {expression: string}) => {
      const restore = params.expression.includes("removeNativeTextPaintSuppression"); calls.push(restore ? "restore" : "suppress");
      return failSuppression && !restore ? {exceptionDetails: {text: "private token"}} : {result: {value: true}};
    }} as unknown as CompositionQaCdpClient;
    const painted = Buffer.from("painted"); let count = 0;
    await assert.rejects(captureDeckTextPaintPair(client, ["deck"], painted,
      async () => failSuppression ? painted : count++ === 0 ? Buffer.from("suppressed") : Buffer.from("changed")),
      failSuppression ? /SUPPRESSION_FAILED/ : /RESTORE_FAILED/);
    assert.deepEqual(calls, ["suppress", "restore"]);
  }
});
