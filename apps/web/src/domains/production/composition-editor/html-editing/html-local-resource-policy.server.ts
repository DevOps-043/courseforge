import { load } from "cheerio";
import postcss from "postcss";

const forbiddenTags = new Set(["script", "iframe", "frame", "object", "embed", "base", "meta", "link", "form", "input", "button", "foreignobject"]);
const resourceAttributes = new Set(["src", "href", "xlink:href", "poster", "background"]);
const fragmentPattern = /^#[a-zA-Z_][\w.-]*$/;

/** Resource admission only, not browser isolation or a general sanitizer.
 * Error codes preserve the controlled renderer's existing contract. */
export function createLocalHtmlResourceValidator(input: {
  remoteToLocal: ReadonlyMap<string, string>; localFiles: ReadonlySet<string>;
}) {
  const referencedLocalFiles = new Set<string>();
  const assertReference = (raw: string) => {
    const reference = raw.trim();
    if (fragmentPattern.test(reference)) return;
    const local = input.remoteToLocal.get(reference) ?? reference;
    if (!input.localFiles.has(local)) throw new Error("CONTROLLED_RENDER_DECK_RESOURCE_NOT_MATERIALIZED");
    referencedLocalFiles.add(local);
  };
  const assertCssValue = (value: string) => {
    if (/[\\<>]|expression\s*\(/i.test(value)) throw new Error("CONTROLLED_RENDER_DECK_CSS_UNSUPPORTED");
    let remaining = value;
    for (const match of value.matchAll(/url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s()'"\r\n]+))\s*\)/gi)) {
      assertReference(match[1] ?? match[2] ?? match[3]);
      remaining = remaining.replace(match[0], "");
    }
    if (/url\s*\(|image-set\s*\(/i.test(remaining)) throw new Error("CONTROLLED_RENDER_DECK_CSS_UNSUPPORTED");
  };
  const assertCss = (css: string) => {
    const root = postcss.parse(css);
    root.walkAtRules(rule => {
      if (/import|namespace/i.test(rule.name) || /[\\<>]/.test(rule.params)) throw new Error("CONTROLLED_RENDER_DECK_CSS_UNSUPPORTED");
      assertCssValue(rule.params);
    });
    root.walkDecls(declaration => {
      if (/behavior|binding|[\\]/i.test(declaration.prop)) throw new Error("CONTROLLED_RENDER_DECK_CSS_UNSUPPORTED");
      assertCssValue(declaration.value);
    });
  };
  const assertFragment = (html: string) => {
    const fragment = load(html, {}, false);
    fragment("*").each((_index, element) => {
      const tag = element.type === "tag" || element.type === "script" || element.type === "style" ? element.name.toLowerCase() : "";
      if (forbiddenTags.has(tag)) throw new Error("CONTROLLED_RENDER_DECK_ACTIVE_CONTENT_UNSUPPORTED");
      if (tag === "style") assertCss(fragment(element).text());
      for (const [name, value] of Object.entries(fragment(element).attr() || {})) {
        const attribute = name.toLowerCase();
        if (attribute.startsWith("on") || ["srcdoc", "srcset", "action", "formaction", "ping", "data-composition-src"].includes(attribute))
          throw new Error("CONTROLLED_RENDER_DECK_ACTIVE_CONTENT_UNSUPPORTED");
        if (resourceAttributes.has(attribute)) assertReference(value);
        if (attribute === "style") assertCss(`.controlled {${value}}`);
        if (["fill", "stroke", "filter", "clip-path", "mask", "cursor"].includes(attribute)) assertCssValue(value);
      }
    });
  };
  return { assertCss, assertFragment, referencedLocalFiles };
}
