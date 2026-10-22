import type { BundleAgentAuthContext } from "../../bundle-agent/types";
import { assertHtmlSlideImportRole } from "./imported-slide-catalog.service";
import { hydrateImportedDesignForOrganization } from "./imported-slide-bundle-assets.server";
import { normalizeImportedSlideDesign } from "./imported-slide-design.service";
import { HtmlSlideImportError } from "./imported-slide-design.contract";
import { importedTemplateBaseSchema } from "./imported-template-base.contract";

export async function loadImportedTemplateBase(context: BundleAgentAuthContext, runId: string) {
  assertHtmlSlideImportRole(context.platformRole);
  const { data: run, error } = await context.admin.from("soflia_bundle_generation_runs").select("id,spec_id,output_hash")
    .eq("id", runId).eq("organization_id", context.organizationId).eq("status", "PACKAGED").maybeSingle();
  if (error) throw error;
  if (!run) throw new HtmlSlideImportError("Base de diseño no encontrada para esta organización.");
  const { data: spec, error: specError } = await context.admin.from("soflia_bundle_specs").select("id,spec_json")
    .eq("id", run.spec_id).eq("organization_id", context.organizationId).maybeSingle();
  if (specError) throw specError;
  if (spec?.spec_json?.artifactKind !== "slide_template" || !spec.spec_json.importedDesign) {
    throw new HtmlSlideImportError("La base no contiene un diseño HTML de diapositivas.");
  }
  const base = importedTemplateBaseSchema.parse({ runId: run.id, specId: spec.id, outputHash: run.output_hash, title: spec.spec_json.title });
  const design = await hydrateImportedDesignForOrganization(normalizeImportedSlideDesign(spec.spec_json.importedDesign), context);
  return { base, design };
}
