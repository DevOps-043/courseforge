import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "cheerio";
import JSZip from "jszip";
import { analyzeImportedSlideHtml, importedDesignPreview, normalizeImportedSlideDesign } from "../import/imported-slide-design.service";
import { HtmlSlideImportError, htmlSlideImportRequestSchema } from "../import/imported-slide-design.contract";
import { sanitizeImportedCss } from "../import/imported-slide-sanitizer.service";
import { assertHtmlSlideImportRole, prepareImportedSlidePackage, saveImportedSlidePackage } from "../import/imported-slide-catalog.service";
import { renderImportedCourseDeckSource } from "../import/imported-slide-renderer.service";
import { buildCourseDeckEditableArtifact } from "../render/course-deck-editable-artifact.server";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import { buildSlideTemplatePackageZip } from "../../bundle-agent/slide-template-package.service";
import type { CourseDeckSpec } from "../specs/course-deck.schema";
import { createImportCatalogFixture } from "./imported-slide-catalog.fixture";

const fixtures = [
  `<html><head><style>body{margin:0;background:#102030;color:#fff}.slide{width:1920px;height:1080px;padding:80px;box-sizing:border-box}h1{font-size:72px}p{font-size:36px}</style></head><body><section class="slide active"><h1>Portada original</h1><p>Contenido original</p></section><script data-od-bridge>window.parent.postMessage('x','*')</script><nav class="deck-counter">Siguiente</nav></body></html>`,
  `<html><head><style>.slide{display:grid;grid-template-columns:1fr 1fr;padding:60px;gap:30px}.card{background:#f0f5fa;padding:24px}h2{font-size:60px}p{font-size:28px}</style></head><body><section class="slide"><h2>Comparación</h2><div class="card"><p>Primer concepto</p></div><div class="card"><p>Segundo concepto</p></div></section></body></html>`,
  `<html><head><style>.slide{padding:80px;background:#f5eee0}h1{font-size:64px}p{font-size:32px}</style></head><body><section class="slide"><h1>Diseño geométrico</h1><p>Explicación educativa</p><svg width="240" height="160" viewBox="0 0 240 160"><rect x="10" y="10" width="200" height="100" fill="#336699" /></svg></section></body></html>`,
];

function deckFor(source = fixtures[0]): CourseDeckSpec {
  const design = analyzeImportedSlideHtml(source).design;
  const spec = prepareImportedSlidePackage("Diseño importado", design);
  const base = spec.examples[0] as unknown as CourseDeckSpec;
  return { ...base, importedDesign: design, slides: [{ ...base.slides[0], type: "concept", title: "Aprendizaje nuevo", subtitle: undefined,
    chart: undefined, visualAssets: undefined, bodyBlocks: [{ kind: "paragraph", text: "Explicación nueva y verificable." }] }] };
}

describe("importación de diseños HTML reutilizables", () => {
  for (const [index, fixture] of fixtures.entries()) {
    it(`conserva la estructura del diseño ${index + 1} y compila su exportación editable`, () => {
      const deck = deckFor(fixture);
      const html = renderCourseDeckHtml(deck);
      assert.match(html, /Aprendizaje nuevo/);
      assert.match(html, /Explicación nueva y verificable/);
      assert.doesNotMatch(html, /Contenido original|Primer concepto|Segundo concepto/);
      assert.match(html, /data-imported-layout="design-1"/);
      const editorial = buildCourseDeckEditableArtifact(deck);
      assert.equal(editorial.preparation, "COMPILER_VALIDATED");
      assert.ok(editorial.fragments[0].template.elements.some(field => field.kind === "TEXT"));
      assert.equal(editorial.fragments[0].template.elements.find(field => field.kind === "TEXT")?.maxCharacters,
        deck.importedDesign!.layouts[0].fields[0].maxCharacters);
      if (index === 1) assert.match(html, /grid-template-columns:1fr 1fr/);
      if (index === 2) assert.match(html, /<svg/);
    });
  }

  it("retira scripts, eventos, red y controles del preview", () => {
    const source = fixtures[0].replace("<p>", `<img src="http://127.0.0.1/private"><iframe src="https://example.test"></iframe><p onclick="alert(1)" style="background:url('/private');color:red">`);
    const result = analyzeImportedSlideHtml(source);
    const preview = importedDesignPreview(result.design, 0);
    assert.equal(result.report.removedScripts, 1);
    assert.equal(result.report.removedResources, 2);
    assert.doesNotMatch(preview, /<script|onclick|<img|<iframe|127\.0\.0\.1|example\.test|url\(/i);
    assert.match(preview, /default-src 'none'/);
    assert.match(preview, /color:red/);
  });

  it("bloquea CSS escapado y elimina funciones de recursos y at-rules externas", () => {
    assert.throws(() => sanitizeImportedCss(String.raw`.slide{background:u\72l('/private')}`), HtmlSlideImportError);
    const css = sanitizeImportedCss(`@import '/secret'; @font-face{font-family:x;src:url('/font')}.slide{background:image('/private');color:#123456}`);
    assert.doesNotMatch(css, /@import|font-face|secret|\/font|private/);
    assert.match(css, /color:#123456/);
    assert.throws(() => sanitizeImportedCss(".slide{& .nested{color:red}}"), HtmlSlideImportError);
  });

  it("materializa el estado visible de Open Design sin conservar su controlador", () => {
    const source = fixtures[0].replace("body{", ".slide{display:none}.slide:not(.active){opacity:0}.slide.active{display:grid}:where(.slide.active){opacity:1}body{");
    const { design } = analyzeImportedSlideHtml(source);
    assert.match(design.css, /\.od-slide\{display:grid\}/);
    assert.match(design.css, /:where\(\.od-slide\)\{opacity:1\}/);
    assert.doesNotMatch(design.css, /\.active|opacity:0/);
  });

  it("conserva nombres de clase parecidos a los selectores del documento y a slide", () => {
    const css = sanitizeImportedCss(".slide-title,.body-copy,.active-state{color:red}.cf-import-root-other{color:blue}body .slide{display:grid}");
    assert.match(css, /\.cf-import-root \.slide-title/);
    assert.match(css, /\.cf-import-root \.body-copy/);
    assert.match(css, /\.cf-import-root \.active-state/);
    assert.match(css, /\.cf-import-root \.cf-import-root-other/);
    assert.match(css, /\.cf-import-root \.od-slide/);
  });

  it("vuelve a sanear JSON persistido o enviado por el cliente", () => {
    const design = analyzeImportedSlideHtml(fixtures[0]).design;
    design.layouts[0].html += `<script>alert(1)</script>`;
    assert.doesNotMatch(importedDesignPreview(design, 0), /<script/);
    assert.deepEqual(normalizeImportedSlideDesign(normalizeImportedSlideDesign(design)), normalizeImportedSlideDesign(design));
  });

  it("rechaza campos duplicados, ausentes y títulos ambiguos", () => {
    const design = analyzeImportedSlideHtml(fixtures[0]).design;
    const duplicate = structuredClone(design); duplicate.layouts[0].fields.push(duplicate.layouts[0].fields[0]);
    assert.throws(() => normalizeImportedSlideDesign(duplicate), HtmlSlideImportError);
    const missing = structuredClone(design); missing.layouts[0].fields[1].id = "field-999";
    assert.throws(() => normalizeImportedSlideDesign(missing), HtmlSlideImportError);
    design.layouts[0].fields[1].role = "title";
    assert.throws(() => normalizeImportedSlideDesign(design), HtmlSlideImportError);
  });

  it("no trunca texto ni omite bloques si ninguna plantilla tiene capacidad", () => {
    const deck = deckFor(); deck.slides[0].bodyBlocks.push({ kind: "paragraph", text: "Otro bloque" });
    assert.throws(() => renderCourseDeckHtml(deck), /no cabe/);
    deck.slides[0].bodyBlocks.pop(); deck.importedDesign!.layouts[0].fields[0].maxCharacters = 2;
    assert.throws(() => renderCourseDeckHtml(deck), /no cabe/);
  });

  it("escapa contenido nuevo y asigna IDs distintos a instancias repetidas", () => {
    const deck = deckFor(fixtures[0].replace("<h1>", '<h1 id="heading">'));
    deck.slides[0].title = `<img src=x onerror=alert(1)>`;
    deck.slides.push({ ...deck.slides[0], id: "segunda", order: 2 });
    const output = renderImportedCourseDeckSource(deck, deck.importedDesign!);
    const fragment = load(output.slides.map(slide => slide.html).join(""));
    assert.equal(fragment("img").length, 0);
    const ids = fragment("[id]").map((_index, node) => fragment(node).attr("id")).get();
    assert.equal(ids.length, new Set(ids).size);
    assert.match(output.slides[0].html, /&lt;img/);
  });

  it("exige revisión y no acepta autoridad ni organización en el payload", () => {
    const design = analyzeImportedSlideHtml(fixtures[0]).design;
    assert.equal(htmlSlideImportRequestSchema.safeParse({ action: "save", title: "Plantilla", design, reviewed: false }).success, false);
    assert.equal(htmlSlideImportRequestSchema.safeParse({ action: "save", title: "Plantilla", design, reviewed: true, organizationId: "otra" }).success, false);
    for (const role of [undefined, null, "BUILDER", "ARCHITECT"]) assert.throws(() => assertHtmlSlideImportRole(role), HtmlSlideImportError);
  });

  it("deniega guardado sin rol antes de tocar la base de datos", async () => {
    await assert.rejects(saveImportedSlidePackage({ admin: { from() { throw new Error("No debe acceder a BD"); } },
      organizationId: "org", userId: "actor", platformRole: "BUILDER" }, "Plantilla", analyzeImportedSlideHtml(fixtures[0]).design), /administrador/);
  });

  it("empaqueta el HTML importado y produce el mismo hash en reintentos", async () => {
    const spec = prepareImportedSlidePackage("Prueba", analyzeImportedSlideHtml(fixtures[1]).design);
    spec.importedDesign!.layouts[0].html += "<script>alert(1)</script>";
    const first = await buildSlideTemplatePackageZip(spec);
    const second = await buildSlideTemplatePackageZip(spec);
    assert.equal(first.hash, second.hash);
    const zip = await JSZip.loadAsync(first.buffer);
    assert.ok(zip.file("blueprints/imported-design.json"));
    assert.match(await zip.file("runtime/example.html")!.async("string"), /grid-template-columns/);
    assert.doesNotMatch(await zip.file("package-spec.json")!.async("string"), /<script>/);
  });

  it("reutiliza una importación y mantiene identidades distintas por organización", async () => {
    const fixture = createImportCatalogFixture();
    const context = { admin: fixture.admin, organizationId: "organizacion-a", userId: "actor", platformRole: "ADMIN" };
    const design = analyzeImportedSlideHtml(fixtures[0]).design;
    const first = await saveImportedSlidePackage(context, "Prueba", design);
    const again = await saveImportedSlidePackage(context, "Prueba", design);
    assert.equal(again.generationRunId, first.generationRunId); assert.equal(again.reused, true);
    const other = await saveImportedSlidePackage({ ...context, organizationId: "organizacion-b" }, "Prueba", design);
    assert.notEqual(other.generationRunId, first.generationRunId);
    assert.equal(fixture.tables.get("soflia_bundle_specs")!.size, 2);
    assert.equal(fixture.files.size, 2);
    assert.ok(fixture.accesses.filter(access => access.operation === "read").every(access => typeof access.filters.organization_id === "string"));
  });

  it("reanuda un fallo posterior al upload sin duplicar registros ni sobrescribir archivos", async () => {
    const fixture = createImportCatalogFixture(); fixture.failure.finalSave = true;
    const context = { admin: fixture.admin, organizationId: "organizacion-a", userId: "actor", platformRole: "ADMIN" };
    const design = analyzeImportedSlideHtml(fixtures[0]).design;
    await assert.rejects(saveImportedSlidePackage(context, "Reintento", design));
    assert.equal([...fixture.tables.get("soflia_bundle_generation_runs")!.values()][0].status, "QUEUED");
    const result = await saveImportedSlidePackage(context, "Reintento", design);
    assert.equal(result.reused, false);
    assert.equal(fixture.tables.get("soflia_bundle_generation_runs")!.size, 1);
    assert.equal([...fixture.tables.get("soflia_bundle_generation_runs")!.values()][0].status, "PACKAGED");
    assert.equal(fixture.files.size, 1);
  });
});
