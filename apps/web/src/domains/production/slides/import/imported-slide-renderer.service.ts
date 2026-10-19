import { load } from "cheerio";
import { createHash } from "node:crypto";
import postcss from "postcss";
import type { CourseDeckSpec, CourseSlideSpec } from "../specs/course-deck.schema";
import { HtmlSlideImportError, type ImportedSlideDesign, type ImportedSlideLayout } from "./imported-slide-design.contract";
import { normalizeImportedSlideDesign } from "./imported-slide-design.service";

function contentValues(slide: CourseSlideSpec, layout: ImportedSlideLayout) {
  const body = slide.bodyBlocks.flatMap(block => block.kind === "bullets" ? block.items || [] : block.text ? [block.text] : []);
  const subtitleField = layout.fields.some(field => field.role === "subtitle");
  if (slide.subtitle && !subtitleField) body.unshift(slide.subtitle);
  let bodyIndex = 0;
  const values = layout.fields.map(field => ({ field, value: field.role === "title" ? slide.title
    : field.role === "subtitle" ? slide.subtitle || "" : field.role === "body" ? body[bodyIndex++] || "" : field.sample }));
  return { values, fits: !slide.chart && bodyIndex >= body.length
    && values.every(({ field, value }) => field.role === "decoration" || Array.from(value).length <= field.maxCharacters) };
}

export function selectImportedLayout(design: ImportedSlideDesign, slide: CourseSlideSpec): ImportedSlideLayout {
  const purpose = slide.type === "cover" ? "cover" : slide.type === "summary" ? "summary" : "content";
  const matches = design.layouts.filter(layout => (layout.purpose === purpose || layout.purpose === "any") && contentValues(slide, layout).fits)
    .sort((left, right) => Number(right.purpose === purpose) - Number(left.purpose === purpose) || left.fields.length - right.fields.length);
  if (!matches.length) throw new HtmlSlideImportError(`La diapositiva ${slide.order} no cabe en los campos de la plantilla importada${slide.chart ? "; esta versión no admite gráficas dinámicas" : ""}. Ajusta el contenido o amplía sus campos.`);
  return matches[(slide.order - 1) % matches.length];
}

/** Comparte la fuente entre presentación y exportación editorial. */
export function renderImportedCourseDeckSource(deck: CourseDeckSpec, value: ImportedSlideDesign) {
  const design = normalizeImportedSlideDesign(value);
  const stylesheet = postcss.parse(design.css);
  // Las clases conservan estilos cuando el host editorial asigna sus propios IDs.
  // El CSS se comparte y no crece con cada instancia de diapositiva.
  const classForId = (id: string) => `cf-import-static-${createHash("sha256").update(id).digest("hex").slice(0, 20)}`;
  stylesheet.walkRules(rule => { rule.selector = rule.selector.replace(/#([a-zA-Z_][\w-]*)/g, (_selector, id: string) => `.${classForId(id)}`); });
  const slides = [...deck.slides].sort((left, right) => left.order - right.order).map((slide, index) => {
    const layout = selectImportedLayout(design, slide);
    const fragment = load(layout.html, {}, false);
    const seenIds = new Set<string>();
    fragment("[id]").each((_position, node) => {
      const target = fragment(node);
      const original = target.attr("id")!;
      if (seenIds.has(original)) throw new HtmlSlideImportError("El diseño contiene IDs HTML duplicados.");
      seenIds.add(original); target.addClass(classForId(original)).removeAttr("id");
    });
    for (const { field, value: text } of contentValues(slide, layout).values) {
      const target = fragment(`[data-cf-field="${field.id}"]`);
      target.text(text);
      if (field.role === "title") target.addClass("cf-import-title");
    }
    const label = slide.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return { slide, html: `<section class="slide${index === 0 ? " active" : ""} cf-import-host" data-screen-label="${label}" data-title="${label}" data-imported-layout="${layout.id}">${fragment.html()}</section>` };
  });
  return { css: `html,body{margin:0;width:100%;height:100%;overflow:hidden}.deck-shell{position:fixed;inset:0;overflow:hidden}.deck-stage{position:absolute;width:1920px;height:1080px;transform-origin:top left}.cf-import-host{position:absolute;inset:0;width:1920px;height:1080px;overflow:hidden;display:none}.cf-import-host.active{display:block}.cf-import-root{position:relative;width:1920px;height:1080px;overflow:hidden}\n${stylesheet.toString()}`, slides };
}
