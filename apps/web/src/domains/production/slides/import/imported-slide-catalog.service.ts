import { createHash } from "node:crypto";
import type { BundleAgentAuthContext } from "../../bundle-agent/types";
import { buildSlideTemplatePackageZip, buildSlideTemplateSpecFromConversation } from "../../bundle-agent/slide-template-package.service";
import { buildCourseDeckEditableArtifact } from "../render/course-deck-editable-artifact.server";
import { HtmlSlideImportError, type ImportedSlideDesign } from "./imported-slide-design.contract";
import { importedDesignDigest, normalizeImportedSlideDesign } from "./imported-slide-design.service";
import { detachedImportedDesign } from "./imported-slide-bundle-assets.server";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";

function importIdentity(organizationId: string, hash: string, kind: string): string {
  const digest = createHash("sha256").update(JSON.stringify([organizationId, hash, kind])).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function assertHtmlSlideImportRole(role: string | null | undefined) {
  if (role !== "ADMIN" && role !== "SUPERADMIN") throw new HtmlSlideImportError("Se requiere acceso de administrador para importar plantillas.");
}

/** Valida la exportación editable existente antes de persistir. */
export function prepareImportedSlidePackage(title: string, value: ImportedSlideDesign) {
  const importedDesign = normalizeImportedSlideDesign(value);
  const spec = buildSlideTemplateSpecFromConversation({ title, messages: [], overrides: {
    title, importedDesign, description: "Diseño HTML importado y revisado para reutilizar contenido educativo.",
    changeSummary: "Importación de una familia HTML estática con campos revisados.",
  } });
  if (importedDesign.assets?.some(asset => !asset.base64)) throw new HtmlSlideImportError("Reabre la plantilla para cargar sus recursos antes de guardar.");
  for (const layout of importedDesign.editingMode === "html-text" ? [] : importedDesign.layouts) {
    const example = spec.examples[0] as unknown as import("../specs/course-deck.schema").CourseDeckSpec;
    try {
      const candidate = { ...example, importedDesign: { ...importedDesign, layouts: [{ ...layout, purpose: "any" as const }] },
        slides: [{ ...example.slides[0], title: "A", subtitle: undefined, chart: undefined, visualAssets: undefined,
          bodyBlocks: [{ kind: "paragraph" as const, text: "" }] }] };
      buildCourseDeckEditableArtifact(candidate);
    } catch {
      throw new HtmlSlideImportError(`${layout.label}: el diseño no es compatible con el editor de diapositivas. Simplifica su HTML/CSS antes de guardarlo.`);
    }
  }
  const baseExample = spec.examples[0] as unknown as import("../specs/course-deck.schema").CourseDeckSpec;
  const first = importedDesign.layouts[0];
  spec.examples = [{ ...baseExample, importedDesign,
    slides: [{ ...baseExample.slides[0], type: first.purpose === "cover" ? "cover" : first.purpose === "summary" ? "summary" : "concept",
      title: "A", subtitle: undefined, chart: undefined, visualAssets: undefined, bodyBlocks: [{ kind: "paragraph", text: "" }] }] }];
  spec.templateManifest = { ...spec.templateManifest, id: `imported-${importedDesignDigest(importedDesign).slice(0, 24)}`,
    importedDesignFormat: importedDesign.format, editingMode: importedDesign.editingMode ?? "native" };
  if (importedDesign.editingMode === "html-text") renderCourseDeckHtml(spec.examples[0] as unknown as import("../specs/course-deck.schema").CourseDeckSpec);
  return spec;
}

/** Los IDs derivados del tenant permiten reanudar filas existentes sin duplicarlas. */
export async function saveImportedSlidePackage(context: BundleAgentAuthContext, title: string, design: ImportedSlideDesign) {
  assertHtmlSlideImportRole(context.platformRole);
  const spec = prepareImportedSlidePackage(title, design);
  const hash = createHash("sha256").update(JSON.stringify([title, importedDesignDigest(spec.importedDesign!)])).digest("hex");
  const conversationId = importIdentity(context.organizationId, hash, "conversation");
  const specId = importIdentity(context.organizationId, hash, "spec");
  const runId = importIdentity(context.organizationId, hash, "run");
  if (spec.importedDesign?.editingMode === "html-text") {
    spec.importedDesign.resourceBundleRunId = runId;
    spec.examples = spec.examples.map(example => ({ ...example, importedDesign: spec.importedDesign }));
  }
  const readRun = async () => {
    const { data, error } = await context.admin.from("soflia_bundle_generation_runs").select("id, status, bundle_storage_path, output_hash")
      .eq("id", runId).eq("organization_id", context.organizationId).maybeSingle();
    if (error) throw error;
    return data;
  };
  if ((await readRun())?.status === "PACKAGED") return { conversationId, generationRunId: runId, reused: true };
  const { data: existingConversation, error: conversationError } = await context.admin.from("soflia_bundle_conversations").select("id")
    .eq("id", conversationId).eq("organization_id", context.organizationId).maybeSingle();
  if (conversationError) throw conversationError;
  if (!existingConversation) {
    const { count, error: countError } = await context.admin.from("soflia_bundle_conversations").select("id", { count: "exact", head: true })
      .eq("organization_id", context.organizationId).eq("artifact_kind", "slide_template")
      .in("status", ["DRAFTING", "READY_FOR_GENERATION", "GENERATING", "VERSION_PENDING_REVIEW", "ACTIVE"]);
    if (countError) throw countError;
    if ((count || 0) >= 100) throw new HtmlSlideImportError("La organización alcanzó el límite de 100 plantillas activas.");
  }
  const rows = [
    { table: "soflia_bundle_conversations", row: { id: conversationId, artifact_kind: "slide_template", organization_id: context.organizationId,
      created_by: context.userId, title, status: "ACTIVE" } },
    { table: "soflia_bundle_specs", row: { id: specId, conversation_id: conversationId, organization_id: context.organizationId,
      version_number: 1, spec_json: { ...spec, importedDesign: detachedImportedDesign(spec.importedDesign!),
        examples: spec.examples.map(example => ({ ...example, importedDesign: detachedImportedDesign(spec.importedDesign!) })) }, spec_hash: hash, created_by: context.userId } },
    { table: "soflia_bundle_generation_runs", row: { id: runId, conversation_id: conversationId, organization_id: context.organizationId,
      spec_id: specId, status: "QUEUED", model: "importacion-html-estatica-v1", input_hash: hash,
      validation_report: { info: { artifactKind: "slide_template", imported: true } } } },
  ];
  for (const { table, row } of rows) {
    const { error } = await context.admin.from(table).upsert(row, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
  const bundle = await buildSlideTemplatePackageZip(spec);
  const path = `organizations/${context.organizationId}/slide-templates/imports/${runId}/${bundle.hash}.slide-template.zip`;
  const bucket = context.admin.storage.from("template-bundles");
  const { error: uploadError } = await bucket.upload(path, Buffer.from(bundle.buffer), { contentType: "application/zip", upsert: false });
  if (uploadError) {
    // Otro reintento concurrente puede haber subido el mismo paquete inmutable.
    const { data: stored, error: downloadError } = await bucket.download(path);
    if (downloadError || !stored || createHash("sha256").update(Buffer.from(await stored.arrayBuffer())).digest("hex") !== bundle.hash) throw uploadError;
  }
  const { data: saved, error } = await context.admin.from("soflia_bundle_generation_runs").update({
    status: "PACKAGED", output_hash: bundle.hash, bundle_storage_path: `template-bundles/${path}`,
    validation_report: { ...bundle.validationReport, info: { ...bundle.validationReport.info, imported: true, layoutCount: design.layouts.length } },
    finished_at: new Date().toISOString(),
  }).eq("id", runId).eq("organization_id", context.organizationId).select("id").single();
  if (error || !saved) throw error || new Error("No se pudo confirmar el guardado de la plantilla.");
  return { conversationId, generationRunId: runId, reused: false };
}
