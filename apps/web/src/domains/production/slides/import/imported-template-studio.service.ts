import type { BundleAgentAuthContext } from "../../bundle-agent/types";
import { parseSlideTemplateAgentSpec } from "../../bundle-agent/slide-template-package.service";
import { prepareImportedSlidePackage, assertHtmlSlideImportRole } from "./imported-slide-catalog.service";
import { detachedImportedDesign, hydrateImportedDesignForOrganization } from "./imported-slide-bundle-assets.server";
import { normalizeImportedSlideDesign } from "./imported-slide-design.service";
import { loadImportedTemplateBase } from "./imported-template-base.service";
import { importedTemplateStudioOptionsSchema, type ImportedTemplateStudioOptions } from "./imported-template-base.contract";
import { applyImportedTemplateEdit, importedTemplateEditContext } from "./imported-template-edit.service";
import { HtmlSlideImportError } from "./imported-slide-design.contract";
import type { ImportedTemplateAiInput } from "./imported-template-ai.server";

export async function createImportedTemplateStudioSpec(input: {
  context: BundleAgentAuthContext; title: string; latestSpec?: unknown; options?: ImportedTemplateStudioOptions;
  messages: Array<{ role: string; content_redacted: string }>;
}, propose?: (input: ImportedTemplateAiInput) => Promise<{ proposal: unknown; model: string }>) {
  assertHtmlSlideImportRole(input.context.platformRole);
  const options = importedTemplateStudioOptionsSchema.parse(input.options ?? {});
  const latest = input.latestSpec ? parseSlideTemplateAgentSpec(input.latestSpec) : null;
  if (latest?.importedDesign && !latest.designBase) throw new HtmlSlideImportError("La base importada es inmutable. Usa «Usar como base» para crear una plantilla nueva.");
  const runId = options.baseRunId ?? latest?.designBase?.runId;
  if (!runId) throw new HtmlSlideImportError("Selecciona una base de diseño para crear la plantilla.");
  if (latest?.designBase && latest.designBase.runId !== runId) throw new HtmlSlideImportError("Crea una plantilla nueva para cambiar su base de origen.");
  const resolved = await loadImportedTemplateBase(input.context, runId);
  if (latest?.designBase && (latest.designBase.specId !== resolved.base.specId || latest.designBase.outputHash !== resolved.base.outputHash)) {
    throw new HtmlSlideImportError("La revisión de la base no coincide con su procedencia guardada.");
  }
  let design = latest?.importedDesign
    ? await hydrateImportedDesignForOrganization(normalizeImportedSlideDesign(latest.importedDesign), input.context) : resolved.design;
  if (options.layoutIds) {
    if (new Set(options.layoutIds).size !== options.layoutIds.length || options.layoutIds.some(id => !design.layouts.some(layout => layout.id === id))) {
      throw new HtmlSlideImportError("La selección contiene diseños inexistentes o repetidos.");
    }
    design = { ...design, layouts: options.layoutIds.map(id => design.layouts.find(layout => layout.id === id)!) };
  }
  let summary = latest?.changeSummary ?? "Nueva plantilla independiente creada desde una base HTML importada.";
  let model = "imported-template-base-v1";
  if (options.reviseWithAi) {
    const instruction = input.messages.filter(message => message.role === "USER").at(-1)?.content_redacted;
    if (!instruction?.trim()) throw new HtmlSlideImportError("Escribe una instrucción para revisar la plantilla con IA.");
    const provider = propose ?? (await import("./imported-template-ai.server")).proposeImportedTemplateEdit;
    const result = await provider({ organizationId: input.context.organizationId, instruction: instruction.slice(0, 12_000), context: importedTemplateEditContext(design) });
    const edited = applyImportedTemplateEdit(design, result.proposal);
    design = edited.design; summary = edited.summary; model = result.model;
  }
  const spec = prepareImportedSlidePackage(input.title, design);
  const detached = detachedImportedDesign(design);
  return { model, source: options.reviseWithAi ? "gemini" as const : "design_base" as const, warning: null,
    spec: parseSlideTemplateAgentSpec({ ...spec, designBase: resolved.base, changeSummary: summary,
      importedDesign: detached, examples: spec.examples.map(example => ({ ...example, importedDesign: detached })) }) };
}
