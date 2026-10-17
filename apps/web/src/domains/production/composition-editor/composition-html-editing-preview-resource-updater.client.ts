import { bindHtmlPreviewCssUrls } from "./composition-html-editing-preview-css-urls";
import { parseHtmlPreviewResourceRenewal, type HtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";

export const HTML_PREVIEW_RESOURCE_UPDATE_POLICY = Object.freeze({ nodes: 50_000, cssRules: 16_384, properties: 131_072 });

/** Frame-only URL-sink updater. Preflight all replacements before writes. No
 * innerHTML, script/text replacement, style-element rewrite, playback clock or
 * document/hash changes. Caller pauses/resynchronizes the existing controller.
 * A write failure is terminal: owner must blank/close the preview, not roll back
 * to expired capabilities or declare partial application successful. */
export function createHtmlPreviewResourceUpdater(input: { initial: HtmlPreviewResourceRenewal; audience: string; document: Document;
  nowSeconds?: () => number; onMediaReload?: (media: HTMLMediaElement) => void }) {
  const { audience, document } = input;
  const expected = { documentId: input.initial.documentId, session: { ...input.initial.session }, audience,
    bundleSha256: input.initial.bundleSha256, inventoryFingerprint: input.initial.inventoryFingerprint };
  let current = parseHtmlPreviewResourceRenewal(input.initial, expected), disposed = false;
  const now = input.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const onMediaReload = input.onMediaReload;
  return {
    apply(candidate: HtmlPreviewResourceRenewal, signal: AbortSignal) {
      try {
        signal.throwIfAborted(); if (disposed) throw new Error();
        const next = parseHtmlPreviewResourceRenewal(candidate, expected);
        const currentTime = now();
        if (!Number.isSafeInteger(currentTime) || currentTime < next.issuedAt || currentTime >= current.expiresAt || currentTime >= next.expiresAt) throw new Error();
        const byAlias = new Map(next.resources.map(resource => [resource.localPath, resource.url]));
        if (next.issuedAt <= current.issuedAt || next.expiresAt <= current.expiresAt || byAlias.size !== current.resources.length
          || current.resources.some(resource => !byAlias.has(resource.localPath))) throw new Error();
        const replacements = new Map(current.resources.map(resource => [resource.url, byAlias.get(resource.localPath)!]));
        const mutations: (() => void)[] = [], media = new Set<HTMLMediaElement>();
        let properties = 0, rules = 0;
        const bind = (reference: string) => {
          if (/^#[a-zA-Z_][\w.-]*$/.test(reference)) return reference;
          const replacement = replacements.get(reference);
          if (!replacement) throw new Error(); return replacement;
        };
        const style = (declaration: CSSStyleDeclaration) => {
          for (let index = 0; index < declaration.length; index++) {
            if (++properties > HTML_PREVIEW_RESOURCE_UPDATE_POLICY.properties) throw new Error();
            const name = declaration.item(index), value = declaration.getPropertyValue(name);
            const bound = bindHtmlPreviewCssUrls(value, bind), priority = declaration.getPropertyPriority(name);
            if (value !== bound) mutations.push(() => declaration.setProperty(name, bound, priority));
          }
        };
        const elements = document.querySelectorAll("*");
        if (elements.length > HTML_PREVIEW_RESOURCE_UPDATE_POLICY.nodes) throw new Error();
        for (const element of elements) {
          if (["script", "style"].includes(element.localName)) continue;
          for (const attribute of Array.from(element.attributes)) {
            if (++properties > HTML_PREVIEW_RESOURCE_UPDATE_POLICY.properties) throw new Error();
            if (["srcset", "srcdoc", "data-composition-src", "data-var-src"].includes(attribute.name)) throw new Error();
            let value = attribute.value;
            if (["src", "href", "xlink:href", "poster", "background"].includes(attribute.name)) value = bind(value);
            else if (["fill", "stroke", "filter", "clip-path", "mask", "cursor"].includes(attribute.name)) value = bindHtmlPreviewCssUrls(value, bind);
            if (value !== attribute.value) {
              mutations.push(() => attribute.namespaceURI
                ? element.setAttributeNS(attribute.namespaceURI, attribute.name, value)
                : element.setAttribute(attribute.name, value));
              if (attribute.name === "src") {
                const owner = ["audio", "video"].includes(element.localName) ? element : element.localName === "source" ? element.parentElement : null;
                if (owner && ["audio", "video"].includes(owner.localName)) media.add(owner as HTMLMediaElement);
              }
            }
          }
          if ("style" in element) style((element as HTMLElement).style);
        }
        const stack: CSSRule[] = [];
        if (document.styleSheets.length > HTML_PREVIEW_RESOURCE_UPDATE_POLICY.cssRules) throw new Error();
        for (const sheet of Array.from(document.styleSheets)) {
          if (sheet.cssRules.length + stack.length > HTML_PREVIEW_RESOURCE_UPDATE_POLICY.cssRules) throw new Error();
          for (const rule of Array.from(sheet.cssRules)) stack.push(rule);
        }
        while (stack.length) {
          if (++rules > HTML_PREVIEW_RESOURCE_UPDATE_POLICY.cssRules) throw new Error();
          const rule = stack.pop()!;
          if ("style" in rule) style((rule as CSSStyleRule).style);
          if ("cssRules" in rule) {
            const nested = Array.from((rule as CSSGroupingRule).cssRules);
            if (stack.length + nested.length + rules > HTML_PREVIEW_RESOURCE_UPDATE_POLICY.cssRules) throw new Error();
            stack.push(...nested);
          }
        }
        signal.throwIfAborted();
        for (const mutate of mutations) { signal.throwIfAborted(); mutate(); }
        for (const element of media) { signal.throwIfAborted(); onMediaReload?.(element); element.load(); }
        signal.throwIfAborted();
        const completedAt = now();
        if (!Number.isSafeInteger(completedAt) || completedAt < currentTime || completedAt >= current.expiresAt || completedAt >= next.expiresAt) throw new Error();
        current = next;
        return { changedSinks: mutations.length, reloadedMedia: media.size };
      } catch { disposed = true; throw new Error("HTML_PREVIEW_RESOURCE_UPDATE_REJECTED"); }
    },
    dispose: () => { disposed = true; },
  };
}
