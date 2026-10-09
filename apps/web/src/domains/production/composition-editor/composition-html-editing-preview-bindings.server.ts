import { load } from "cheerio";
import postcss from "postcss";
import { buildCompositionHtmlEditingPreviewCsp, HTML_EDITING_PREVIEW_CSP_POLICY } from "./composition-html-editing-preview-csp.server";
import { bindHtmlPreviewCssUrls as bindCssValue } from "./composition-html-editing-preview-css-urls";

export class HtmlPreviewBindingsError extends Error {
  constructor() { super("HTML_PREVIEW_RESOURCE_BINDINGS_INVALID"); this.name = "HtmlPreviewBindingsError"; }
}
const fragment = /^#[a-zA-Z_][\w.-]*$/;
/** Host-only successful compiler page, not arbitrary user HTML. Bind ONLY DOM
 * resource attributes and CSS URL nodes; scripts/text/IDs/source remain intact.
 * Every actual resource must be in this independently authorized mapping. */
export function bindCompositionHtmlPreviewResources(input: {
  trustedCompiledPage: string; resourceEndpoint: string; resourceUrls: ReadonlyMap<string, string>;
}) {
  try {
    if (Buffer.byteLength(input.trustedCompiledPage) > HTML_EDITING_PREVIEW_CSP_POLICY.pageBytes) throw new Error();
    const endpoint = new URL(input.resourceEndpoint), allowed = new Set(input.resourceUrls.values());
    for (const url of allowed) {
      const parsed = new URL(url);
      if (parsed.origin !== endpoint.origin || parsed.pathname !== endpoint.pathname || parsed.hash || parsed.username || parsed.password
        || parsed.searchParams.getAll("cap").length !== 1 || !parsed.searchParams.get("cap")
        || [...parsed.searchParams.keys()].some(key => key !== "cap")) throw new Error();
    }
    const referenced = new Set<string>();
    const bind = (reference: string) => {
      if (fragment.test(reference)) return reference;
      const destination = input.resourceUrls.get(reference);
      if (!destination) throw new Error();
      referenced.add(reference); return destination;
    };
    const css = (value: string) => {
      const root = postcss.parse(value);
      root.walkAtRules(rule => { if (/^(import|namespace)$/i.test(rule.name)) throw new Error();
        rule.params = bindCssValue(rule.params, bind); });
      root.walkDecls(declaration => { declaration.value = bindCssValue(declaration.value, bind); });
      return root.toString();
    };
    const page = load(input.trustedCompiledPage);
    page("*").each((_index, element) => {
      const node = page(element);
      if (element.type === "script") return; // Trusted runtime ABI is mounted separately.
      if (element.type === "style") node.text(css(node.html() ?? ""));
      for (const [name, value] of Object.entries(node.attr() ?? {})) {
        if (["src", "href", "xlink:href", "poster", "background"].includes(name)) node.attr(name, bind(value));
        else if (name === "style") node.attr(name, css(value));
        else if (["fill", "stroke", "filter", "clip-path", "mask", "cursor"].includes(name)) node.attr(name, bindCssValue(value, bind));
        else if (["srcset", "srcdoc", "data-composition-src", "data-var-src"].includes(name)) throw new Error();
      }
    });
    const html = page.html();
    return { html, contentSecurityPolicy: buildCompositionHtmlEditingPreviewCsp(html, input.resourceEndpoint), referenced };
  } catch { throw new HtmlPreviewBindingsError(); }
}
