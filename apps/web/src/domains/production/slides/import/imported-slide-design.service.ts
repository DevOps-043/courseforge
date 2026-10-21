import { load } from "cheerio";
import { createHash } from "node:crypto";
import {
  HTML_SLIDE_IMPORT_LIMITS, HtmlSlideImportError, importedSlideDesignSchema,
  IMPORT_PREVIEW_CSP, formatHtmlSlideImportBytes, type ImportedSlideDesign, type ImportedSlideLayout,
} from "./imported-slide-design.contract";
import { cleanImportedDocument, sanitizeImportedCss, sanitizeImportedMarkup } from "./imported-slide-sanitizer.service";

export function analyzeImportedSlideHtml(html: string) {
  const cleaned = cleanImportedDocument(html);
  const sourceSlides = cleaned.document(".od-slide").toArray();
  if (!sourceSlides.length || sourceSlides.length > HTML_SLIDE_IMPORT_LIMITS.slides
    || sourceSlides.some(node => cleaned.document(node).find(".od-slide").length)) {
    throw new HtmlSlideImportError(`Se requieren entre 1 y ${HTML_SLIDE_IMPORT_LIMITS.slides} diapositivas .slide, sin diapositivas anidadas.`);
  }
  const layouts = sourceSlides.map((_source, index): ImportedSlideLayout => {
    const copy = load(cleaned.document.html());
    copy(".od-slide").each((position, node) => { if (position !== index) copy(node).remove(); });
    const sourceRoot = copy("<div></div>").addClass(`cf-import-root ${copy("body").attr("class") || ""}`).html(copy("body").html() || "");
    if (copy("body").attr("style")) sourceRoot.attr("style", copy("body").attr("style")!);
    const fragment = load(sanitizeImportedMarkup(copy.html(sourceRoot)), {}, false);
    // El texto mixto también se declara para que pueda revisarse como campo.
    fragment("*").each((_position, node) => {
      const element = fragment(node);
      if (!element.children().length || element.closest("svg").length) return;
      for (const child of element.contents().toArray()) {
        if (child.type === "text" && child.data.trim()) fragment(child).replaceWith(fragment("<span></span>").text(child.data));
      }
    });
    const fields: ImportedSlideLayout["fields"] = [];
    fragment("*").each((_position, node) => {
      const element = fragment(node);
      if (element.children().length || element.closest("svg").length || !element.text().trim()) return;
      const sample = element.text().trim();
      if (sample.length > 2000) throw new HtmlSlideImportError("Un campo de texto es demasiado largo para convertirse en plantilla.");
      const id = `field-${fields.length + 1}`;
      const heading = element.is("h1, h2") || element.closest("h1, h2").length > 0;
      const title = !fields.some(field => field.role === "title") && heading;
      fields.push({ id, sample, role: title ? "title" : element.is("p, li") || element.closest("p, li").length ? "body" : "decoration",
        maxCharacters: Math.min(HTML_SLIDE_IMPORT_LIMITS.textCharacters, Math.max(title ? 180 : 240, sample.length)) });
      element.attr("data-cf-field", id);
    });
    if (fields.length && !fields.some(field => field.role === "title")) fields[0].role = "title";
    return { id: `design-${index + 1}`, label: fields.find(field => field.role === "title")?.sample.slice(0, 120) || `Diseño ${index + 1}`,
      purpose: "any", html: fragment.html(), fields };
  });
  const design = importedSlideDesignSchema.parse({ format: "courseforge-imported-slide-design-v1", css: cleaned.css, layouts });
  return { design: normalizeImportedSlideDesign(design), report: {
    removedScripts: cleaned.removedScripts, removedResources: cleaned.removedResources,
    warnings: ["Revisa los roles y límites de los campos antes de guardar. Las animaciones se convierten a una composición estática.",
      "Las imágenes, fuentes y recursos externos no se incorporan en esta versión. Revisa también fondos y tipografías en el preview."] },
  };
}

/** Revalida también el JSON persistido: el cliente y el modelo no conceden confianza. */
export function normalizeImportedSlideDesign(value: unknown): ImportedSlideDesign {
  const parsed = importedSlideDesignSchema.parse(value);
  assertImportedDesignByteBudget(parsed);
  if (new Set(parsed.layouts.map(layout => layout.id)).size !== parsed.layouts.length) throw new HtmlSlideImportError("Los diseños tienen identificadores repetidos.");
  const normalized = { ...parsed, css: sanitizeImportedCss(parsed.css), layouts: parsed.layouts.map(layout => {
    const fragment = load(sanitizeImportedMarkup(layout.html), {}, false);
    const pending = fragment.root().contents().toArray().map(node => ({ node, depth: 1 }));
    let elements = 0;
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++elements > HTML_SLIDE_IMPORT_LIMITS.sourceElements || depth > HTML_SLIDE_IMPORT_LIMITS.sourceDepth) throw new HtmlSlideImportError("El diseño excede la complejidad HTML admitida.");
      if ("children" in node) for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
    }
    if (fragment(".cf-import-root").length !== 1 || fragment.root().children().length !== 1 || !fragment.root().children().first().hasClass("cf-import-root")) throw new HtmlSlideImportError("El diseño requiere una única raíz aislada.");
    if (layout.fields.filter(field => field.role === "title").length !== 1) throw new HtmlSlideImportError(`${layout.label}: debe existir exactamente un campo de título.`);
    if (layout.fields.filter(field => field.role === "subtitle").length > 1) throw new HtmlSlideImportError(`${layout.label}: solo se admite un campo de subtítulo.`);
    if (new Set(layout.fields.map(field => field.id)).size !== layout.fields.length
      || fragment("[data-cf-field]").length !== layout.fields.length) throw new HtmlSlideImportError("Los campos declarados no coinciden con el HTML.");
    for (const field of layout.fields) {
      const target = fragment(`[data-cf-field="${field.id}"]`);
      if (target.length !== 1 || target.children().length || target.closest("svg").length) throw new HtmlSlideImportError("Un campo no identifica un texto editable único.");
      if (field.role === "decoration" && target.text().trim() !== field.sample) throw new HtmlSlideImportError("El texto decorativo no coincide con su declaración.");
    }
    // Los IDs externos no pueden conceder permisos de edición.
    fragment("*").each((_index, node) => {
      const target = fragment(node);
      target.removeAttr("data-courseforge-editable-id");
      const classes = (target.attr("class") || "").split(/\s+/).filter(name => name !== "slide" && name !== "active");
      target.attr("class", classes.join(" "));
    });
    return { ...layout, html: fragment.html() };
  }) };
  assertImportedDesignByteBudget(normalized);
  return normalized;
}

function assertImportedDesignByteBudget(design: ImportedSlideDesign) {
  if (Buffer.byteLength(JSON.stringify(design), "utf8") > HTML_SLIDE_IMPORT_LIMITS.designBytes) {
    throw new HtmlSlideImportError(`La familia de diseños procesada supera ${formatHtmlSlideImportBytes(HTML_SLIDE_IMPORT_LIMITS.designBytes)}.`);
  }
}

export function importedDesignDigest(design: ImportedSlideDesign): string {
  return createHash("sha256").update(JSON.stringify(normalizeImportedSlideDesign(design))).digest("hex");
}

export function importedDesignPreview(design: ImportedSlideDesign, index: number): string {
  const normalized = normalizeImportedSlideDesign(design);
  const layout = normalized.layouts[index];
  if (!layout) throw new HtmlSlideImportError("El diseño solicitado no existe.");
  return buildNormalizedPreview(normalized.css, layout.html);
}

function buildNormalizedPreview(css: string, html: string): string {
  return `<!doctype html><html lang="es"><head><meta http-equiv="Content-Security-Policy" content="${IMPORT_PREVIEW_CSP}"><style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden}.cf-import-root{position:relative;width:1920px;height:1080px;overflow:hidden}${css}</style></head><body>${html}</body></html>`;
}

/** Presupuesto independiente para la expansión de CSS/HTML en los previews. */
export function withImportedSlidePreviews<T extends { design: ImportedSlideDesign }>(payload: T) {
  const design = normalizeImportedSlideDesign(payload.design);
  const response = { ...payload, design, previews: design.layouts.map(layout => buildNormalizedPreview(design.css, layout.html)) };
  if (Buffer.byteLength(JSON.stringify(response), "utf8") + HTML_SLIDE_IMPORT_LIMITS.responseEnvelopeBytes > HTML_SLIDE_IMPORT_LIMITS.responseBytes) {
    throw new HtmlSlideImportError(`Los previews completos superan ${formatHtmlSlideImportBytes(HTML_SLIDE_IMPORT_LIMITS.responseBytes)}. Reduce el CSS compartido o divide la familia de diseños.`);
  }
  return response;
}
