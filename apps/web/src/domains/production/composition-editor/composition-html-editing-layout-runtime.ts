import { load } from "cheerio";
import { HTML_COMPUTED_LAYOUT_POLICY, assertHtmlComputedElementGeometry,
  type HtmlComputedLayoutPolicy, type HtmlComputedElementGeometry } from "./html-editing/html-editing-computed-layout-policy";
import { HTML_EDITING_SCOPE_ATTRIBUTE } from "./html-editing/html-editing-isolation.server";
import { createHtmlComputedPaintGeometry } from "./html-editing/html-editing-computed-paint-geometry";

export type HtmlLayoutReadiness = "PENDING" | "READY" | "FAILED" | "DISPOSED";

// Emitted once as inert compiler-owned markup so the preview CSP can authorize
// the exact style later assigned to native-parent measurement references.
export const HTML_COMPUTED_REFERENCE_STYLE = "all:initial!important;position:absolute!important;display:block!important;left:0!important;top:0!important;width:1px!important;height:1px!important;visibility:hidden!important;overflow:hidden!important;transform:none!important;pointer-events:none!important";

/** Runs inside the existing compiled page. It owns no clock, renderer, resource
 * authority or permission. Failure is terminal for this exact page. The render
 * executor must await ready and invoke assert before consuming a frame. */
export function installHtmlComputedLayoutRuntime(browser: Window, scopeKeys: readonly string[],
  policy: HtmlComputedLayoutPolicy, validate: typeof assertHtmlComputedElementGeometry,
  paint = createHtmlComputedPaintGeometry(policy), referenceStyle = HTML_COMPUTED_REFERENCE_STYLE) {
  const page = browser.document;
  let state: HtmlLayoutReadiness = "PENDING";
  let resourceTimer: number | undefined;
  let stopPending: (() => void) | undefined;
  const getState = () => state;
  const fail = (): never => { state = "FAILED"; throw new Error("HTML_COMPUTED_LAYOUT_UNAVAILABLE"); };
  const roots = scopeKeys.map(key => {
    if (!/^[a-f0-9]{64}$/.test(key)) return fail();
    const matches = page.querySelectorAll(`[data-courseforge-html-scope="${key}"]`);
    if (matches.length !== 1) return fail();
    return matches[0];
  });
  if (!roots.length || new Set(scopeKeys).size !== scopeKeys.length) fail();
  // A source SVG is not a trustworthy normalizer: its viewBox can hide its own
  // scale. This empty reference is outside the isolated source, in the same
  // native parent, so native rotation/zoom/crop are divided out, not forbidden.
  const references: SVGSVGElement[] = [];
  try {
    for (const root of roots) {
      if (!root.parentElement || root.parentElement.closest("[data-courseforge-html-scope]")) return fail();
      const reference = page.createElementNS("http://www.w3.org/2000/svg", "svg");
      references.push(reference);
      reference.setAttribute("viewBox", "0 0 1 1");
      reference.setAttribute("aria-hidden", "true");
      reference.setAttribute("style", referenceStyle);
      root.parentElement.append(reference);
    }
  } catch { for (const reference of references) reference.remove(); return fail(); }
  const lengths = ["width", "height", "min-width", "min-height", "max-width", "max-height",
    "top", "right", "bottom", "left", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding-top", "padding-right", "padding-bottom", "padding-left", "row-gap", "column-gap",
    "letter-spacing", "word-spacing", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width"];
  const pixel = (raw: string): number | null => {
    if (["auto", "none", "normal", "min-content", "max-content", "fit-content", ""].includes(raw)) return null;
    // CSSOM can retain percentages for min/max sizes and SVG geometry. Do not
    // reinterpret them as pixels or forbid all relative layouts. Their used
    // geometry must be observed separately; this is not an SVG matrix bound.
    if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(raw)) return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)px$/.test(raw)) return fail();
    const amount = Number.parseFloat(raw);
    if (!Number.isFinite(amount)) return fail();
    return amount;
  };
  const tracks = (raw: string) => {
    if (!raw || raw === "none") return 0;
    if (raw.length > policy.maximumTrackCharacters) return fail();
    // CSSOM expands implicit tracks. Named lines are not additional tracks.
    const withoutNames = raw.replace(/\[[^\]]*\]/g, "").trim();
    const tokens = withoutNames.split(/\s+/).filter(Boolean);
    if (tokens.some(token => !/^(?:\d+(?:\.\d*)?|\.\d+)px$/.test(token))) return fail();
    return tokens.length;
  };
  const measure = () => {
    if (page.fonts.status !== "loaded") return fail();
    let elements = 0, fragments = 0, nodes = 0;
    const countBoxes = (boxes: DOMRectList) => {
      if (!Number.isSafeInteger(boxes.length) || boxes.length > policy.maximumFragmentsPerElement) return fail();
      fragments += boxes.length;
      if (fragments > policy.maximumFragments) return fail();
    };
    for (const [rootIndex, root] of roots.entries()) {
      // A source can never authorize additional scope roots introduced later.
      if (!root.isConnected) return fail();
      const reference = references[rootIndex];
      if (!reference.isConnected || reference.parentElement !== root.parentElement) return fail();
      // Inactive native clips have no rendered boxes; do not manufacture an
      // identity matrix for them. Activation/seek is followed by fresh assert.
      const active = root.getClientRects().length > 0;
      const referenceInverse = active ? paint.inverse(reference.getScreenCTM()!) : undefined;
      const range = page.createRange();
      const walker = page.createTreeWalker(root, 5 /* SHOW_ELEMENT | SHOW_TEXT */);
      let node: Node | null = root;
      while (node) {
        if (++nodes > policy.maximumNodes) return fail();
        if (node.nodeType === 3) {
          range.selectNodeContents(node);
          const boxes = range.getClientRects(); countBoxes(boxes);
          if (referenceInverse) for (const box of Array.from(boxes)) paint.rectangle(box, referenceInverse);
          node = walker.nextNode(); continue;
        }
        const element = node as Element;
        if (++elements > policy.maximumElements) return fail();
        const boxes = element.getClientRects(); countBoxes(boxes);
        if (referenceInverse) for (const box of Array.from(boxes)) paint.rectangle(box, referenceInverse);
        for (const pseudo of [null, "::before", "::after"] as const) {
          const style = browser.getComputedStyle(element, pseudo);
          if (pseudo && ["none", "normal"].includes(style.content)) continue;
          const font = pixel(style.fontSize), line = pixel(style.lineHeight);
          if (font === null) return fail();
          const grid = style.display === "grid" || style.display === "inline-grid";
          const filter = style.getPropertyValue("filter");
          if (filter && filter !== "none") {
            const blur = /^blur\(([\d.]+)px\)$/.exec(filter);
            if (!blur || !Number.isFinite(Number(blur[1])) || Number(blur[1]) > policy.maximumEffectPixels) return fail();
          }
          const measured: HtmlComputedElementGeometry = {
            lengths: lengths.map(name => pixel(style.getPropertyValue(name))).filter((amount): amount is number => amount !== null),
            fontPixels: font, lineHeightPixels: line,
            scrollWidth: pseudo ? 0 : element.scrollWidth, scrollHeight: pseudo ? 0 : element.scrollHeight,
            fragments: pseudo ? 0 : boxes.length,
            gridColumns: grid ? tracks(style.gridTemplateColumns) : 0,
            gridRows: grid ? tracks(style.gridTemplateRows) : 0,
          };
          validate(measured, policy);
          if (!pseudo && element === root && (!style.contain.split(/\s+/).includes("paint")
            || !style.contain.split(/\s+/).includes("layout") || style.display !== "block"
            || style.isolation !== "isolate"
            || ![style.overflowX, style.overflowY].every(value => value === "hidden" || value === "clip")
            || style.getPropertyValue("overflow-clip-margin") !== "0px")) return fail();
          if (!pseudo && element.localName === "img") {
            const image = element as HTMLImageElement;
            if (![image.naturalWidth, image.naturalHeight].every(value => Number.isFinite(value) && value > 0 && value <= policy.maximumPixels)) return fail();
          }
          if (!pseudo && referenceInverse && boxes.length && element.namespaceURI === "http://www.w3.org/2000/svg"
            && typeof (element as SVGGraphicsElement).getBBox === "function") {
            const graphic = element as SVGGraphicsElement;
            const stroke = style.stroke === "none" ? 0 : pixel(style.strokeWidth);
            if (stroke === null) return fail();
            paint.svg({ screenMatrix: graphic.getScreenCTM()!, referenceInverse, box: graphic.getBBox(),
              strokePixels: stroke, miterLimit: Number(style.strokeMiterlimit) });
          }
        }
        node = walker.nextNode();
      }
    }
  };
  const assert = () => {
    if (state !== "READY") throw new Error("HTML_COMPUTED_LAYOUT_NOT_READY");
    // Observer delivery is asynchronous: a cached verdict could miss an edit
    // immediately followed by seek. Always observe the current used layout.
    try { measure(); } catch { fail(); }
  };
  const dispose = () => {
    state = "DISPOSED";
    stopPending?.();
    if (resourceTimer !== undefined) browser.clearTimeout(resourceTimer);
    for (const reference of references) reference.remove();
  };
  const ready = (async () => {
    try {
      const images: HTMLImageElement[] = [];
      let elements = 0;
      for (const root of roots) {
        const walker = page.createTreeWalker(root, 1);
        let element: Element | null = root;
        while (element) {
          if (++elements > policy.maximumElements) return fail();
          if (element.localName === "img") images.push(element as HTMLImageElement);
          element = walker.nextNode() as Element | null;
        }
        // Resolve actual font use before obtaining fonts.ready.
        root.getBoundingClientRect();
      }
      await Promise.race([
        Promise.all([page.fonts.ready, ...images.map(image => image.decode())]),
        new Promise<never>((_resolve, reject) => {
          stopPending = () => reject(new Error("HTML_LAYOUT_DISPOSED"));
          resourceTimer = browser.setTimeout(() => reject(new Error("HTML_LAYOUT_RESOURCE_TIMEOUT")), policy.resourceTimeoutMilliseconds);
        }),
      ]);
      if (state !== "PENDING") throw new Error();
      measure();
      state = "READY";
    } catch { if (getState() !== "DISPOSED") state = "FAILED"; throw new Error("HTML_COMPUTED_LAYOUT_UNAVAILABLE"); }
    finally { stopPending = undefined; if (resourceTimer !== undefined) browser.clearTimeout(resourceTimer); }
  })();
  // Render consumers still receive a rejected promise; avoid an unhandled
  // rejection before a host attaches its readiness handler.
  void ready.catch(() => undefined);
  browser.addEventListener("pagehide", dispose, { once: true });
  return Object.freeze({ ready, assert, getState });
}

export function renderHtmlComputedLayoutRuntime(fragments: ReadonlyMap<string, string>): string {
  if (!fragments.size) return "";
  const keys = [...fragments.values()].map(fragment => {
    const parsed = load(fragment), scopes = parsed(`[${HTML_EDITING_SCOPE_ATTRIBUTE}]`);
    if (scopes.length !== 1) throw new Error("HTML_COMPUTED_LAYOUT_SCOPE_MISMATCH");
    const key = scopes.attr(HTML_EDITING_SCOPE_ATTRIBUTE)!;
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("HTML_COMPUTED_LAYOUT_SCOPE_MISMATCH");
    return key;
  });
  if (new Set(keys).size !== keys.length) throw new Error("HTML_COMPUTED_LAYOUT_SCOPE_MISMATCH");
  return `<template><svg style="${HTML_COMPUTED_REFERENCE_STYLE}"></svg></template><script>Object.defineProperty(window, "__courseforgeHtmlLayout", { value: (${installHtmlComputedLayoutRuntime.toString()})(window, ${JSON.stringify(keys)}, ${JSON.stringify(HTML_COMPUTED_LAYOUT_POLICY)}, ${assertHtmlComputedElementGeometry.toString()}, (${createHtmlComputedPaintGeometry.toString()})(${JSON.stringify(HTML_COMPUTED_LAYOUT_POLICY)}), ${JSON.stringify(HTML_COMPUTED_REFERENCE_STYLE)}), writable: false, configurable: false });</script>`;
}
