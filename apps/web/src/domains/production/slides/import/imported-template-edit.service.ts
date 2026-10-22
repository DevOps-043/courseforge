import { load } from "cheerio";
import { HtmlSlideImportError, type ImportedSlideDesign } from "./imported-slide-design.contract";
import { normalizeImportedSlideDesign } from "./imported-slide-design.service";
import { importedTemplateEditSchema, IMPORTED_TEMPLATE_EDIT_LIMITS } from "./imported-template-base.contract";
import { sanitizeImportedCss } from "./imported-slide-sanitizer.service";

export function importedTemplateEditContext(design: ImportedSlideDesign): string {
  const context = JSON.stringify({ css: design.css, layouts: design.layouts });
  if (Buffer.byteLength(context, "utf8") > IMPORTED_TEMPLATE_EDIT_LIMITS.contextBytes) {
    throw new HtmlSlideImportError("Selecciona menos diseños para revisar esta base con IA; su estructura supera el presupuesto de edición.");
  }
  return context;
}

/** Aplica datos estructurados; nunca incorpora HTML ni recursos propuestos por el modelo. */
export function applyImportedTemplateEdit(source: ImportedSlideDesign, proposal: unknown) {
  const patch = importedTemplateEditSchema.parse(proposal);
  const design = structuredClone(source);
  const seenFields = new Set<string>(), seenLayouts = new Set<string>();
  for (const edit of patch.layouts) {
    const layout = design.layouts.find(item => item.id === edit.id);
    if (!layout || seenLayouts.has(edit.id)) throw new HtmlSlideImportError("La revisión contiene un diseño inexistente o repetido.");
    seenLayouts.add(edit.id);
    if (edit.label !== undefined) layout.label = edit.label;
    if (edit.purpose !== undefined) layout.purpose = edit.purpose;
  }
  for (const edit of patch.fields) {
    const layout = design.layouts.find(item => item.id === edit.layoutId);
    const field = layout?.fields.find(item => item.id === edit.fieldId);
    const key = `${edit.layoutId}/${edit.fieldId}`;
    if (!layout || !field || seenFields.has(key)) throw new HtmlSlideImportError("La revisión contiene un campo inexistente o repetido.");
    seenFields.add(key);
    const fragment = load(layout.html, {}, false);
    const target = fragment(`[data-cf-field="${field.id}"]`);
    if (edit.clear) {
      if (edit.text !== undefined || edit.role !== undefined) throw new HtmlSlideImportError("Vaciar un campo no admite texto ni rol adicionales.");
      field.sample = ""; field.role = "decoration"; target.text("");
    } else {
      if (edit.role !== undefined) field.role = edit.role;
      if (edit.text !== undefined) {
        if (Array.from(edit.text).length > field.maxCharacters) throw new HtmlSlideImportError("El texto propuesto supera la capacidad del campo.");
        const original = target.text();
        field.sample = edit.text.trim();
        target.text(`${original.match(/^\s*/)?.[0] ?? ""}${edit.text}${original.match(/\s*$/)?.[0] ?? ""}`);
      }
    }
    layout.html = fragment.html();
  }
  if (patch.cssAppend) {
    if (/url\s*\(|@import\b|expression\s*\(|[\\<\u0000]/i.test(patch.cssAppend)) {
      throw new HtmlSlideImportError("La revisión CSS no admite recursos, código ni escapes.");
    }
    const css = sanitizeImportedCss(patch.cssAppend, false, design.editingMode === "html-text");
    if (css && !design.css.includes(css)) design.css += `\n${css}`;
  }
  return { design: normalizeImportedSlideDesign(design), summary: patch.summary };
}
