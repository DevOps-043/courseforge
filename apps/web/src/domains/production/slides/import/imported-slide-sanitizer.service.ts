import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";
import postcss from "postcss";
import { HTML_SLIDE_IMPORT_LIMITS, HTML_SLIDE_SOURCE_SIZE_LABEL, HtmlSlideImportError } from "./imported-slide-design.contract";
import { importedCssResourceFallback } from "./imported-slide-asset-renderer";
import { importedAssetReference } from "./imported-slide-assets.contract";

const STATIC_TAGS = ["div", "section", "article", "main", "header", "footer", "aside", "p", "span", "strong", "em", "b", "i",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "figure", "figcaption", "br",
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc"];
const SVG_ATTRIBUTES = ["viewbox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
  "d", "points", "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "transform", "text-anchor", "font-size"];

/** Rechaza CSS con red o código ejecutable, incluidos tokens escapados. */
export function sanitizeImportedCss(source: string, scoped = false, embeddedAssets = false): string {
  if (source.length > HTML_SLIDE_IMPORT_LIMITS.cssCharacters) throw new HtmlSlideImportError("El CSS excede el límite de importación.");
  try {
    const stylesheet = postcss.parse(source);
    const pending = stylesheet.nodes.map(node => ({ node, depth: 1 }));
    let nodes = 0;
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++nodes > HTML_SLIDE_IMPORT_LIMITS.cssNodes || depth > HTML_SLIDE_IMPORT_LIMITS.cssDepth) throw new HtmlSlideImportError("El CSS excede la complejidad admitida.");
      if ("nodes" in node && node.nodes) for (const child of node.nodes) pending.push({ node: child, depth: depth + 1 });
    }
    stylesheet.walkComments(comment => { comment.remove(); });
    if (/[\\<\u0000]/.test(stylesheet.toString())) throw new HtmlSlideImportError("El CSS contiene escapes o construcciones incompatibles.");
    stylesheet.walkAtRules(rule => {
      if (embeddedAssets && rule.name.toLowerCase() === "font-face" && !rule.params) return;
      if (rule.name.toLowerCase() !== "media" || !/^[a-zA-Z0-9\s():.,\-]+$/.test(rule.params)) rule.remove();
    });
    stylesheet.walkDecls(declaration => {
      const checkedValue = embeddedAssets ? declaration.value.replace(/url\(\s*["']?cf-asset:asset-[1-9][0-9]*["']?\s*\)/g, "none") : declaration.value;
      if (/url\s*\(|(?:image|image-set|cross-fade|src|expression|paint|element|attr)\s*\(|(?:https?:|data:|javascript:|\/\/)/i.test(declaration.value)
        && /url\s*\(|(?:image|image-set|cross-fade|src|expression|paint|element|attr)\s*\(|(?:https?:|data:|javascript:|\/\/)/i.test(checkedValue)
        || /^(?:behavior|-moz-binding|animation|transition)/i.test(declaration.prop)) {
        const fallback = importedCssResourceFallback(declaration.prop, checkedValue);
        if (fallback && !/(?:https?:|data:|javascript:|\/\/|expression\s*\()/i.test(fallback)) declaration.value = fallback;
        else declaration.remove();
        return;
      }
      if (declaration.prop === "position" && declaration.value.toLowerCase() === "fixed") declaration.value = "absolute";
    });
    stylesheet.walkRules(rule => {
      // El ancla visual no debe conservar el prefijo del controlador de OpenDesign.
      rule.selector = rule.selector.replace(/(\[\s*)data-od-id(?=\s*(?:[~|^$*]?=|\]))/gi, "$1data-cf-design-id");
      if (rule.parent?.type === "rule" || /[&@]|:(?:has|host|host-context)\s*\(/i.test(rule.selector)) {
        throw new HtmlSlideImportError("El CSS anidado o sus selectores no son compatibles.");
      }
      if (/\.deck-(?:counter|hint)|:(?:hover|focus|visited)|:not\(/i.test(rule.selector)) { rule.remove(); return; }
      rule.selector = rule.selector.replace(/\.active(?![\w-])/g, "").trim();
      if (!rule.selector) { rule.remove(); return; }
      if (!scoped) {
        rule.selector = rule.selectors.map(selector => {
          const normalized = selector.replace(/(^|[\s>+~,(])(?:html|body)(?=$|[\s>+~,.#[:)])/g, "$1.cf-import-root")
            .replace(/:root\b/g, ".cf-import-root").replace(/\.slide(?![\w-])/g, ".od-slide");
          const collapsed = normalized.replace(/(?:\.cf-import-root\s+)+\.cf-import-root/g, ".cf-import-root");
          return /^\.cf-import-root(?=$|[\s.:#\[>+~])/.test(collapsed) ? collapsed : `.cf-import-root ${collapsed}`;
        }).join(", ");
      }
    });
    return stylesheet.toString();
  } catch (error) {
    if (error instanceof HtmlSlideImportError) throw error;
    throw new HtmlSlideImportError("No se pudo interpretar el CSS de la presentación.");
  }
}

export function sanitizeImportedMarkup(source: string, embeddedAssets = false): string {
  return sanitizeHtml(source, {
    allowedTags: embeddedAssets ? [...STATIC_TAGS, "img", "a", "small", "sup", "sub"] : STATIC_TAGS,
    allowedAttributes: { "*": ["id", "class", "style", "data-cf-field", "data-cf-design-id", "aria-label", ...SVG_ATTRIBUTES], img: ["data-cf-resource", "alt"] },
    allowedSchemes: [], allowProtocolRelative: false, parseStyleAttributes: false,
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed", "foreignobject"],
    transformTags: { "*": (tagName, attribs) => {
      const attributes = { ...attribs };
      if (attributes["data-od-id"] !== undefined) {
        attributes["data-cf-design-id"] = attributes["data-od-id"];
        delete attributes["data-od-id"];
      }
      if (tagName === "img") {
        const reference = importedAssetReference.exec(attributes.src ?? "");
        if (reference) attributes["data-cf-resource"] = reference[1];
        delete attributes.src;
      }
      if (attributes.style) {
        let parsed: ReturnType<typeof postcss.parse>;
        try { parsed = postcss.parse(`span{${attributes.style}}`); }
        catch { throw new HtmlSlideImportError("Un estilo inline no es CSS válido."); }
        if (parsed.nodes.length !== 1 || parsed.first?.type !== "rule" || parsed.first.nodes.some(node => node.type !== "decl")) {
          throw new HtmlSlideImportError("Un estilo inline contiene construcciones incompatibles.");
        }
        attributes.style = sanitizeImportedCss(`span{${attributes.style}}`, true, embeddedAssets).replace(/^span\s*\{|\}$/g, "");
      }
      for (const attribute of SVG_ATTRIBUTES) {
        if (attributes[attribute] && /url\s*\(|[\\<>]|(?:https?:|data:|javascript:)/i.test(attributes[attribute])) delete attributes[attribute];
      }
      return { tagName: tagName === "section" ? "div" : tagName, attribs: attributes };
    } },
  });
}

export function cleanImportedDocument(html: string, embeddedAssets = false) {
  if (Buffer.byteLength(html, "utf8") > HTML_SLIDE_IMPORT_LIMITS.sourceBytes) throw new HtmlSlideImportError(`El HTML supera ${HTML_SLIDE_SOURCE_SIZE_LABEL}.`);
  const document = load(html);
  if (document("*").length > 10_000) throw new HtmlSlideImportError("El documento contiene demasiados elementos.");
  const removedScripts = document("script").length;
  const removedResources = document(`${embeddedAssets ? "" : "img,"} video, audio, iframe, object, embed, link, image, use`).length;
  const css = sanitizeImportedCss(document("style").map((_index, node) => document(node).text()).get().join("\n"), false, embeddedAssets);
  document(`script, style, link, meta, base, ${embeddedAssets ? "" : "img,"} video, audio, iframe, object, embed, image, use, nav, .deck-counter, .deck-hint, .notes`).remove();
  document("*").each((_index, node) => {
    const element = document(node);
    element.removeAttr("data-cf-field");
    const classes = (element.attr("class") || "").split(/\s+/).filter(name => name && name !== "active").map(name => name === "slide" ? "od-slide" : name);
    element.attr("class", classes.join(" "));
  });
  return { document, css, removedScripts, removedResources };
}
