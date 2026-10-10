import assert from "node:assert/strict";
import test from "node:test";
import { Script, createContext } from "node:vm";
import { load } from "cheerio";
import { HTML_COMPUTED_LAYOUT_POLICY, assertHtmlComputedElementGeometry,
  type HtmlComputedElementGeometry } from "../html-editing/html-editing-computed-layout-policy";
import { installHtmlComputedLayoutRuntime, renderHtmlComputedLayoutRuntime } from "../composition-html-editing-layout-runtime";
import { createHtmlComputedPaintGeometry, type HtmlComputedMatrix } from "../html-editing/html-editing-computed-paint-geometry";

const key = "a".repeat(64);
function fixture() {
  const events = new EventTarget(), fontEvents = new EventTarget();
  let width = "120px", scrollWidth = 120, rows = "none", fragmentCount = 1, display = "grid";
  let nativeMatrix: HtmlComputedMatrix = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0};
  let box = {x: 0, y: 0, width: 120, height: 80};
  let clipped = true;
  let resolveFont: () => void = () => {};
  const fontReady = new Promise<void>(resolve => { resolveFont = resolve; });
  const screenBox = (local: typeof box) => {
    const points = [[local.x, local.y], [local.x + local.width, local.y], [local.x, local.y + local.height],
      [local.x + local.width, local.y + local.height]].map(([x, y]) => [nativeMatrix.a * x + nativeMatrix.c * y + nativeMatrix.e,
      nativeMatrix.b * x + nativeMatrix.d * y + nativeMatrix.f]);
    const x = Math.min(...points.map(point => point[0])), y = Math.min(...points.map(point => point[1]));
    return {x, y, width: Math.max(...points.map(point => point[0])) - x, height: Math.max(...points.map(point => point[1])) - y};
  };
  const references: Array<{isConnected: boolean}> = [];
  const parent = {closest: () => null, append: (reference: {isConnected: boolean}) => {references.push(reference); reference.isConnected = true;} };
  const root = { isConnected: true, nodeType: 1, namespaceURI: "http://www.w3.org/1999/xhtml", localName: "div", scrollHeight: 80,
    parentElement: parent, get scrollWidth() { return scrollWidth; },
    getClientRects: () => Array.from({length: fragmentCount}, () => screenBox(box)), getBoundingClientRect: () => screenBox(box) };
  const descendants: unknown[] = [{...root, parentElement: root}];
  const page = { fonts: Object.assign(fontEvents, { status: "loaded", ready: fontReady }),
    querySelectorAll: () => [root], createTreeWalker: (_root: unknown, mask: number) => {
      let index = 0; const selected = descendants.filter(node => mask === 5 || (node as {nodeType: number}).nodeType === 1);
      return { nextNode: () => selected[index++] ?? null }; },
    createRange: () => { let selected: {boxes?: typeof box[]} | undefined;
      return {selectNodeContents: (node: typeof selected) => { selected = node; }, getClientRects: () => selected?.boxes ?? []}; },
    createElementNS: () => { const reference = {isConnected: false, parentElement: parent,
      setAttribute: () => {}, getScreenCTM: () => nativeMatrix, remove: () => {reference.isConnected = false;} }; return reference; } };
  const browser = Object.assign(events, { document: page,
    setTimeout, clearTimeout, getComputedStyle: (element: unknown, pseudo: string | null) => ({
      content: pseudo ? "none" : "normal", fontSize: "16px", lineHeight: "normal",
      get display() { return element === root ? "block" : display; }, contain: "layout paint style", isolation: "isolate",
      get overflowX() { return clipped ? "hidden" : "visible"; }, overflowY: "hidden",
      stroke: "none", strokeWidth: "1px", strokeMiterlimit: "4",
      gridTemplateColumns: "100px", get gridTemplateRows() { return rows; },
      getPropertyValue: (name: string) => name === "width" ? width : name === "height" ? "80px"
        : name === "overflow-clip-margin" ? "0px" : name === "filter" ? "none" : "auto",
    }) });
  return { browser: browser as unknown as Parameters<typeof installHtmlComputedLayoutRuntime>[0], resolveFont,
    setWidth: (value: string, scroll = 120) => { width = value; scrollWidth = scroll; },
    setRows: (value: string) => { rows = value; }, setFragments: (count: number) => { fragmentCount = count; },
    setDisplay: (value: string) => { display = value; },
    setNativeMatrix: (value: HtmlComputedMatrix) => { nativeMatrix = value; }, setBox: (value: typeof box) => {box = value;},
    setClipped: (value: boolean) => {clipped = value;}, references,
    addText: (boxes: typeof box[]) => descendants.push({nodeType: 3, boxes}),
    addSvg: (localMatrix: HtmlComputedMatrix) => descendants.push({...root, namespaceURI: "http://www.w3.org/2000/svg", localName: "svg",
      getScreenCTM: () => createHtmlComputedPaintGeometry(HTML_COMPUTED_LAYOUT_POLICY).multiply(nativeMatrix, localMatrix),
      getBBox: () => ({x: 0, y: 0, width: 1, height: 1})}),
    addImage: (decode: () => Promise<void>) => descendants.push({...root, localName: "img", naturalWidth: 120, naturalHeight: 80, decode}),
    dispose: () => events.dispatchEvent(new Event("pagehide")) };
}
function install(f: ReturnType<typeof fixture>) {
  return installHtmlComputedLayoutRuntime(f.browser, [key], HTML_COMPUTED_LAYOUT_POLICY, assertHtmlComputedElementGeometry);
}
test("computed geometry validates measured size, overflow, fragmentation and implicit grid allocation", () => {
  const safe: HtmlComputedElementGeometry = {lengths: [120, -40], fontPixels: 16, lineHeightPixels: null,
    scrollWidth: 120, scrollHeight: 80, fragments: 1, gridColumns: 8, gridRows: 8};
  assert.doesNotThrow(() => assertHtmlComputedElementGeometry(safe, HTML_COMPUTED_LAYOUT_POLICY));
  for (const change of [{lengths: [8193]}, {scrollWidth: 8193}, {scrollHeight: Infinity}, {fontPixels: 513},
    {lineHeightPixels: 2049}, {fragments: 513}, {gridColumns: 129}, {gridColumns: 128, gridRows: 128}]) {
    assert.throws(() => assertHtmlComputedElementGeometry({...safe, ...change}, HTML_COMPUTED_LAYOUT_POLICY), /REJECTED/);
  }
});

test("computed paint rejects nonfinite/singular/3D measurements and off-canvas or oversized rectangles", () => {
  const paint = createHtmlComputedPaintGeometry(HTML_COMPUTED_LAYOUT_POLICY);
  const identity = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0};
  assert.doesNotThrow(() => paint.rectangle({x: -30, y: 0, width: 120, height: 80}, identity));
  for (const matrix of [{...identity, a: Infinity}, {...identity, a: 0, d: 0}, {...identity, is2D: false}])
    assert.throws(() => paint.inverse(matrix), /REJECTED/);
  for (const box of [{x: 8193, y: 0, width: 1, height: 1}, {x: -8193, y: 0, width: 1, height: 1},
    {x: -5000, y: 0, width: 10000, height: 1}, {x: 0, y: 0, width: -1, height: 1}, {x: 0, y: NaN, width: 1, height: 1}])
    assert.throws(() => paint.rectangle(box, identity), /REJECTED/);
});

test("SVG effective matrix normalizes native zoom/rotation but retains source scale, shear, translation and stroke", () => {
  const paint = createHtmlComputedPaintGeometry(HTML_COMPUTED_LAYOUT_POLICY);
  const native = {a: 0, b: 20, c: -20, d: 0, e: 900, f: -40};
  const identity = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0};
  const input = {referenceInverse: paint.inverse(native), screenMatrix: native,
    box: {x: 0, y: 0, width: 1, height: 1}, strokePixels: 0, miterLimit: 4};
  assert.doesNotThrow(() => paint.svg(input));
  assert.doesNotThrow(() => paint.svg({...input, screenMatrix: paint.multiply(native, {...identity, a: 16.0000001})}));
  assert.throws(() => paint.svg({...input, screenMatrix: paint.multiply(native, {...identity, a: 16.001})}), /REJECTED/);
  for (const local of [{...identity, a: 17}, {...identity, c: 17}, {...identity, e: 8193}, {...identity, f: -8193}])
    assert.throws(() => paint.svg({...input, screenMatrix: paint.multiply(native, local)}), /REJECTED/);
  assert.throws(() => paint.svg({...input, box: {...input.box, x: 8190}, strokePixels: 4}), /REJECTED/);
  assert.throws(() => paint.svg({...input, strokePixels: 1, miterLimit: 17}), /REJECTED/);
});

test("runtime validates text fragments, source SVG matrices and protected clipping after every layout change", async () => {
  for (const mutate of [(f: ReturnType<typeof fixture>) => f.addText([{x: -9000, y: 0, width: 20, height: 16}]),
    (f: ReturnType<typeof fixture>) => f.addSvg({a: 20, b: 0, c: 0, d: 20, e: 0, f: 0}),
    (f: ReturnType<typeof fixture>) => f.setClipped(false),
    (f: ReturnType<typeof fixture>) => f.setBox({x: -9000, y: 0, width: 120, height: 80})]) {
    const f = fixture(), runtime = install(f); f.resolveFont(); await runtime.ready;
    mutate(f); assert.throws(runtime.assert, /UNAVAILABLE/); assert.equal(runtime.getState(), "FAILED"); f.dispose();
    assert.ok(f.references.every(reference => !reference.isConnected));
  }
});

test("runtime uses its own native-parent reference rather than a source SVG to divide out native motion", async () => {
  const f = fixture(); f.setNativeMatrix({a: 0, b: 20, c: -20, d: 0, e: 1000, f: 300});
  f.addSvg({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0});
  const runtime = install(f); f.resolveFont(); await runtime.ready; assert.doesNotThrow(runtime.assert);
  assert.equal(f.references.length, 1); f.dispose(); assert.equal(f.references[0]!.isConnected, false);
});

test("inactive native clips do not invent a valid SVG matrix; activation must pass fresh geometry", async () => {
  const f = fixture(); f.setFragments(0); f.setNativeMatrix({a: 0, b: 0, c: 0, d: 0, e: 0, f: 0});
  f.addSvg({a: 20, b: 0, c: 0, d: 20, e: 0, f: 0});
  const runtime = install(f); f.resolveFont(); await runtime.ready; assert.doesNotThrow(runtime.assert);
  f.setFragments(1); f.setNativeMatrix({a: 1, b: 0, c: 0, d: 1, e: 0, f: 0});
  assert.throws(runtime.assert, /UNAVAILABLE/); assert.equal(runtime.getState(), "FAILED"); f.dispose();
});
test("readiness waits for fonts and measured layout, not just emitted source syntax", async () => {
  const f = fixture(), runtime = install(f);
  assert.equal(runtime.getState(), "PENDING"); assert.throws(runtime.assert, /NOT_READY/);
  f.resolveFont(); await runtime.ready;
  assert.equal(runtime.getState(), "READY"); assert.doesNotThrow(runtime.assert);
  f.dispose(); assert.equal(runtime.getState(), "DISPOSED");
  assert.throws(runtime.assert, /NOT_READY/);
});
test("resolved oversized relative/intrinsic layout fails and cannot become ready again", async () => {
  const f = fixture(); f.setWidth("16000px", 16000);
  const runtime = install(f); f.resolveFont();
  await assert.rejects(runtime.ready, /UNAVAILABLE/); assert.equal(runtime.getState(), "FAILED");
  f.setWidth("120px"); assert.throws(runtime.assert, /NOT_READY/); f.dispose();
});
test("CSSOM percentages are not treated as pixels or blanket rejected; observed overflow still rejects", async () => {
  const f = fixture(); f.setWidth("100%"); const runtime = install(f); f.resolveFont(); await runtime.ready;
  f.setWidth("100%", 8193); assert.throws(runtime.assert, /UNAVAILABLE/);
  assert.equal(runtime.getState(), "FAILED"); f.dispose();
});
test("layout changes remeasure synchronously without waiting for an observer or another frame", async () => {
  for (const change of [(f: ReturnType<typeof fixture>) => f.setRows(Array(129).fill("1px").join(" ")),
    (f: ReturnType<typeof fixture>) => f.setFragments(513)]) {
    const f = fixture(), runtime = install(f); f.resolveFont(); await runtime.ready;
    change(f); assert.throws(runtime.assert, /UNAVAILABLE/); f.dispose();
  }
});
test("inactive grid declarations do not reject a flex layout whose measured geometry is bounded", async () => {
  const f = fixture(); f.setDisplay("flex"); f.setRows("repeat(100, 1fr)");
  const runtime = install(f); f.resolveFont(); await runtime.ready; assert.doesNotThrow(runtime.assert); f.dispose();
});
test("disposing while fonts are pending settles readiness without retaining a timeout", async () => {
  const f = fixture(), runtime = install(f); f.dispose();
  await assert.rejects(runtime.ready, /UNAVAILABLE/); assert.equal(runtime.getState(), "DISPOSED");
});
test("readiness waits for image decode and a rejected decode cannot approve a page", async () => {
  const pending = fixture(); let release: () => void = () => {}, decodes = 0;
  pending.addImage(() => { decodes++; return new Promise<void>(resolve => { release = resolve; }); });
  const waiting = install(pending); pending.resolveFont(); await Promise.resolve();
  assert.equal(decodes, 1); assert.equal(waiting.getState(), "PENDING");
  release(); await waiting.ready; assert.equal(waiting.getState(), "READY"); pending.dispose();
  const failed = fixture(); failed.addImage(async () => { throw new Error("private decoder detail"); });
  const rejected = install(failed); failed.resolveFont();
  await assert.rejects(rejected.ready, error => error instanceof Error && error.message === "HTML_COMPUTED_LAYOUT_UNAVAILABLE");
  assert.equal(rejected.getState(), "FAILED"); failed.dispose();
});
test("generated script has no module dependencies and enforces exact compiler-owned scopes", async () => {
  const fragments = new Map([["clip", `<div data-courseforge-html-scope="${key}"><div>text</div></div>`]]);
  const html = renderHtmlComputedLayoutRuntime(fragments), script = load(html)("script").text();
  const f = fixture(), context = createContext({window: f.browser});
  new Script(script).runInContext(context); f.resolveFont();
  const api = (f.browser as unknown as {__courseforgeHtmlLayout: ReturnType<typeof install>}).__courseforgeHtmlLayout;
  await api.ready; assert.equal(api.getState(), "READY"); assert.doesNotThrow(api.assert);
  assert.equal(Object.getOwnPropertyDescriptor(f.browser, "__courseforgeHtmlLayout")!.writable, false);
  f.dispose();
  assert.equal(renderHtmlComputedLayoutRuntime(new Map()), "");
  assert.throws(() => renderHtmlComputedLayoutRuntime(new Map([["clip", "<div>no scope</div>"]])));
  assert.throws(() => renderHtmlComputedLayoutRuntime(new Map([...fragments, ["other", fragments.get("clip")!]])));
});
