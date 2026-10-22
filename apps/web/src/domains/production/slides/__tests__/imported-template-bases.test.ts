import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { prepareImportedSlideFile } from "../import/imported-slide-file-preparation.service";
import { analyzeImportedSlideHtml, importedDesignPreview } from "../import/imported-slide-design.service";
import { saveImportedSlidePackage } from "../import/imported-slide-catalog.service";
import { createImportCatalogFixture } from "./imported-slide-catalog.fixture";
import { loadImportedTemplateBase } from "../import/imported-template-base.service";
import { createImportedTemplateStudioSpec } from "../import/imported-template-studio.service";
import { applyImportedTemplateEdit } from "../import/imported-template-edit.service";
import { hydrateImportedDesignForOrganization } from "../import/imported-slide-bundle-assets.server";
import { buildSlideTemplatePackageZip } from "../../bundle-agent/slide-template-package.service";
import { createBundleAgentSpecRequestSchema } from "../../bundle-agent/request-contract";

const image = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kdzcAAAAASUVORK5CYII=";
async function setup() {
  const source = `<style>.slide{background:#123456;padding:80px}h1{font-size:64px}</style><section class="slide"><h1>Base original</h1><p>October 2026</p><img src="data:image/png;base64,${image}"></section><section class="slide"><h1>Otra composición</h1><p>Contenido original</p></section>`;
  const prepared = await prepareImportedSlideFile(new Blob([source]), () => {}, true);
  const design = analyzeImportedSlideHtml(prepared.html, prepared).design;
  const fixture = createImportCatalogFixture();
  const context = { admin: fixture.admin, organizationId: "organizacion-a", userId: "actor", platformRole: "ADMIN" };
  const saved = await saveImportedSlidePackage(context, "Base reutilizable", design);
  return { ...fixture, context, saved, design };
}

describe("bases importadas del estudio de plantillas", () => {
  it("resuelve una revisión privada y deniega roles, tenants y runs no disponibles", async () => {
    const fixture = await setup();
    const base = await loadImportedTemplateBase(fixture.context, fixture.saved.generationRunId);
    assert.equal(base.design.assets![0].base64, image);
    assert.equal(base.base.runId, fixture.saved.generationRunId);
    await assert.rejects(loadImportedTemplateBase({ ...fixture.context, platformRole: "BUILDER" }, fixture.saved.generationRunId), /administrador/);
    await assert.rejects(loadImportedTemplateBase({ ...fixture.context, organizationId: "organizacion-b" }, fixture.saved.generationRunId), /no encontrada/);
    fixture.tables.get("soflia_bundle_generation_runs")!.get(fixture.saved.generationRunId)!.status = "FAILED";
    await assert.rejects(loadImportedTemplateBase(fixture.context, fixture.saved.generationRunId), /no encontrada/);
  });

  it("crea una plantilla individual desde una composición sin mutar la base", async () => {
    const fixture = await setup();
    const before = JSON.stringify([...fixture.tables.get("soflia_bundle_specs")!.values()]);
    const derived = await createImportedTemplateStudioSpec({ context: fixture.context, title: "Variante nueva", messages: [],
      options: { baseRunId: fixture.saved.generationRunId, layoutIds: ["design-2"] } });
    assert.equal(derived.spec.title, "Variante nueva");
    assert.equal(derived.spec.importedDesign!.layouts.length, 1);
    assert.equal(derived.spec.importedDesign!.layouts[0].id, "design-2");
    assert.match(derived.spec.importedDesign!.css, /#123456/);
    assert.doesNotMatch(JSON.stringify(derived.spec), /"base64"/);
    const hydrated = await hydrateImportedDesignForOrganization(derived.spec.importedDesign!, fixture.context);
    const bundle = await buildSlideTemplatePackageZip({ ...derived.spec, importedDesign: hydrated });
    assert.equal(bundle.validationReport.info.layoutCount, 1);
    const zip = await JSZip.loadAsync(bundle.buffer);
    assert.match(await zip.file("README.md")!.async("string"), /design-2/);
    assert.doesNotMatch(await zip.file("README.md")!.async("string"), /- split:|- framework:/);
    assert.equal(JSON.stringify([...fixture.tables.get("soflia_bundle_specs")!.values()]), before);
  });

  it("aplica parches de IA, elimina texto real y conserva revisiones al guardar de nuevo", async () => {
    const fixture = await setup();
    let calls = 0;
    const revised = await createImportedTemplateStudioSpec({ context: fixture.context, title: "Variante", messages: [{ role: "USER", content_redacted: "Cambia la portada y retira la fecha" }],
      options: { baseRunId: fixture.saved.generationRunId, reviseWithAi: true } }, async input => {
      calls++;
      assert.doesNotMatch(input.context, /base64/);
      assert.match(input.context, /October 2026/);
      return { model: "proveedor-simulado", proposal: { summary: "Portada y fecha revisadas", cssAppend: '.cf-import-root h1{color:#fedcba}',
        fields: [{ layoutId: "design-1", fieldId: "field-1", text: "Liderazgo" }, { layoutId: "design-1", fieldId: "field-2", clear: true }] } };
    });
    const next = await createImportedTemplateStudioSpec({ context: fixture.context, title: "Variante guardada", latestSpec: revised.spec, messages: [] });
    assert.equal(calls, 1);
    assert.match(next.spec.importedDesign!.css, /#fedcba/);
    assert.doesNotMatch(next.spec.importedDesign!.layouts[0].html, /October 2026/);
    assert.match(next.spec.importedDesign!.layouts[0].html, /Liderazgo/);
    const full = await hydrateImportedDesignForOrganization(next.spec.importedDesign!, fixture.context);
    assert.match(importedDesignPreview(full, 0), /data:image\/png;base64/);
    const zip = await JSZip.loadAsync((await buildSlideTemplatePackageZip({ ...next.spec, importedDesign: full })).buffer);
    assert.ok(zip.file("assets/asset-1.png"));
    assert.match(await zip.file("runtime/design-1.html")!.async("string"), /Liderazgo/);
    assert.doesNotMatch(await zip.file("runtime/design-1.html")!.async("string"), /October 2026/);
  });

  it("rechaza IDs ajenos, duplicados, capacidad, autoridad y pérdida del título", async () => {
    const { design } = await setup();
    for (const fields of [
      [{ layoutId: "design-99", fieldId: "field-1", text: "No" }],
      [{ layoutId: "design-1", fieldId: "field-1", clear: true }],
      [{ layoutId: "design-1", fieldId: "field-2", text: "X".repeat(901) }],
      [{ layoutId: "design-1", fieldId: "field-2", clear: true, text: "No" }],
      [{ layoutId: "design-1", fieldId: "field-2", clear: true }, { layoutId: "design-1", fieldId: "field-2", clear: true }],
    ]) assert.throws(() => applyImportedTemplateEdit(design, { summary: "Cambio inválido", fields }));
    assert.throws(() => applyImportedTemplateEdit(design, { summary: "Código", html: "<script>1</script>" }));
    assert.throws(() => applyImportedTemplateEdit(design, { summary: "Recurso externo", cssAppend: '.cf-import-root{background:url("https://example.test")}'}), /no admite recursos/);
    assert.throws(() => applyImportedTemplateEdit(design, { summary: "CSS escapado", cssAppend: String.raw`.cf-import-root{background:u\72l('/private')}` }), /no admite recursos/);
    const styled = applyImportedTemplateEdit(design, { summary: "Estilo", cssAppend: '.cf-import-root h1{color:#fedcba}' });
    const repeated = applyImportedTemplateEdit(styled.design, { summary: "Estilo repetido", cssAppend: '.cf-import-root h1{color:#fedcba}' });
    assert.equal(repeated.design.css, styled.design.css);
    assert.equal(createBundleAgentSpecRequestSchema.safeParse({ artifactKind: "slide_template", importedBase: { organizationId: "otra" } }).success, false);
    const result = applyImportedTemplateEdit(design, { summary: "Texto literal", fields: [{ layoutId: "design-1", fieldId: "field-2", text: "<img onerror=alert(1)>" }] });
    assert.match(result.design.layouts[0].html, /&lt;img/);
    assert.doesNotMatch(result.design.layouts[0].html, /<img onerror/);
  });

  it("falla sin persistir si el proveedor no devuelve una revisión válida", async () => {
    const fixture = await setup();
    const before = JSON.stringify([...fixture.tables.get("soflia_bundle_specs")!.values()]);
    await assert.rejects(createImportedTemplateStudioSpec({ context: fixture.context, title: "Sin revisión", messages: [{ role: "USER", content_redacted: "Editar" }],
      options: { baseRunId: fixture.saved.generationRunId, reviseWithAi: true } }, async () => { throw new Error("Proveedor no disponible"); }), /Proveedor no disponible/);
    assert.equal(JSON.stringify([...fixture.tables.get("soflia_bundle_specs")!.values()]), before);
    const initial = await createImportedTemplateStudioSpec({ context: fixture.context, title: "Primera", messages: [], options: { baseRunId: fixture.saved.generationRunId } });
    await assert.rejects(createImportedTemplateStudioSpec({ context: fixture.context, title: "Otra", latestSpec: initial.spec, messages: [],
      options: { baseRunId: "00000000-0000-4000-8000-000000000000" } }), /cambiar su base/);
  });
});
