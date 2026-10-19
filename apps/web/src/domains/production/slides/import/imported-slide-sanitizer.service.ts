import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";
import postcss from "postcss";
import { HTML_SLIDE_IMPORT_LIMITS, HtmlSlideImportError } from "./imported-slide-design.contract";

const STATIC_TAGS = ["div", "section", "article", "main", "header", "footer", "aside", "p", "span", "strong", "em", "b", "i",
  "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "figure", "figcaption", "br",
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "title", "desc"];
const SVG_ATTRIBUTES = ["viewbox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry",
  "d", "points", "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "transform", "text-anchor", "font-size"];

/** Rechaza CSS con red o código ejecutable, incluidos tokens escapados. */
export function sanitizeImportedCss(source: string, scoped = false): string {
  if (source.length > HTML_SLIDE_IMPORT_LIMITS.cssCharacters) throw new HtmlSlideImportError("El CSS excede el límite de importación.");
  if (/[\\<>\u0000]/.test(source)) throw new HtmlSlideImportError("El CSS contiene escapes o construcciones incompatibles.");
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
    stylesheet.walkAtRules(rule => {
      if (rule.name.toLowerCase() !== "media" || !/^[a-zA-Z0-9\s():.,\-]+$/.test(rule.params)) rule.remove();
    });
    stylesheet.walkDecls(declaration => {
      if (/url\s*\(|(?:image|image-set|cross-fade|src|expression|paint|element|attr)\s*\(|(?:https?:|data:|javascript:|\/\/)/i.test(declaration.value)
        || /^(?:behavior|-moz-binding|animation|transition)/i.test(declaration.prop)) { declaration.remove(); return; }
      if (declaration.prop === "position" && declaration.value.toLowerCase() === "fixed") declaration.value = "absolute";
    });
    stylesheet.walkRules(rule => {
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

export function sanitizeImportedMarkup(source: string): string {
  return sanitizeHtml(source, {
    allowedTags: STATIC_TAGS,
    allowedAttributes: { "*": ["id", "class", "style", "data-cf-field", "aria-label", ...SVG_ATTRIBUTES] },
    allowedSchemes: [], allowProtocolRelative: false, parseStyleAttributes: false,
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe", "object", "embed", "foreignobject"],
    transformTags: { "*": (tagName, attribs) => {
      const attributes = { ...attribs };
      if (attributes.style) {
        let parsed: ReturnType<typeof postcss.parse>;
        try { parsed = postcss.parse(`span{${attributes.style}}`); }
        catch { throw new HtmlSlideImportError("Un estilo inline no es CSS válido."); }
        if (parsed.nodes.length !== 1 || parsed.first?.type !== "rule" || parsed.first.nodes.some(node => node.type !== "decl")) {
          throw new HtmlSlideImportError("Un estilo inline contiene construcciones incompatibles.");
        }
        attributes.style = sanitizeImportedCss(`span{${attributes.style}}`, true).replace(/^span\s*\{|\}$/g, "");
      }
      for (const attribute of SVG_ATTRIBUTES) {
        if (attributes[attribute] && /url\s*\(|[\\<>]|(?:https?:|data:|javascript:)/i.test(attributes[attribute])) delete attributes[attribute];
      }
      return { tagName: tagName === "section" ? "div" : tagName, attribs: attributes };
    } },
  });
}

export function cleanImportedDocument(html: string) {
  if (Buffer.byteLength(html, "utf8") > HTML_SLIDE_IMPORT_LIMITS.sourceBytes) throw new HtmlSlideImportError("El HTML supera 500 KB.");
  const document = load(html);
  if (document("*").length > 10_000) throw new HtmlSlideImportError("El documento contiene demasiados elementos.");
  const removedScripts = document("script").length;
  const removedResources = document("img, video, audio, iframe, object, embed, link, image, use").length;
  const css = sanitizeImportedCss(document("style").map((_index, node) => document(node).text()).get().join("\n"));
  document("script, style, link, meta, base, img, video, audio, iframe, object, embed, image, use, nav, .deck-counter, .deck-hint, .notes").remove();
  document("*").each((_index, node) => {
    const element = document(node);
    element.removeAttr("data-cf-field");
    const classes = (element.attr("class") || "").split(/\s+/).filter(name => name && name !== "active").map(name => name === "slide" ? "od-slide" : name);
    element.attr("class", classes.join(" "));
  });
  return { document, css, removedScripts, removedResources };
}
