import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "cheerio";
import JSZip from "jszip";
import { analyzeImportedSlideHtml, importedDesignPreview, normalizeImportedSlideDesign, withImportedSlidePreviews } from "../import/imported-slide-design.service";
import { HTML_SLIDE_IMPORT_LIMITS, HtmlSlideImportError, htmlSlideImportRequestSchema } from "../import/imported-slide-design.contract";
import { parseImportedSlideRequest } from "../import/imported-slide-request.service";
import { prepareImportedSlideFile } from "../import/imported-slide-file-preparation.service";
import { HTML_SLIDE_FILE_LIMITS } from "../import/imported-slide-file.contract";
import { createImportedCssUrlReducer } from "../import/imported-slide-css-url-reducer";
import { sanitizeImportedCss } from "../import/imported-slide-sanitizer.service";
import { assertHtmlSlideImportRole, prepareImportedSlidePackage, saveImportedSlidePackage } from "../import/imported-slide-catalog.service";
import { renderImportedCourseDeckSource } from "../import/imported-slide-renderer.service";
import { buildCourseDeckEditableArtifact } from "../render/course-deck-editable-artifact.server";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import { buildSlideTemplatePackageZip } from "../../bundle-agent/slide-template-package.service";
import type { CourseDeckSpec } from "../specs/course-deck.schema";
import { createImportCatalogFixture } from "./imported-slide-catalog.fixture";
import { createHash } from "node:crypto";
import { normalizeImportedAssets } from "../import/imported-slide-assets.server";
import { detachedImportedDesign, hydrateImportedDesignBundle, hydrateImportedDesignForOrganization } from "../import/imported-slide-bundle-assets.server";
import { hydrateImportedPreview } from "../import/imported-slide-asset-renderer";

const tinyPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kdzcAAAAASUVORK5CYII=";
async function preservedDesign() {
  const source = fixtures[0].replace("</style>", `.slide{background:#102030 url("data:image/png;base64,${tinyPng}") center/cover no-repeat}</style>`)
    .replace("</section>", `<img src="data:image/png;base64,${tinyPng}" alt="Marca"><img src="data:image/png;base64,${tinyPng}" alt="Marca repetida"></section>`);
  const prepared = await prepareImportedSlideFile(new Blob([source]), () => {}, true);
  return analyzeImportedSlideHtml(prepared.html, prepared).design;
}

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
  it("deduplica recursos y conserva el fondo y las imágenes del perfil HTML", async () => {
    const design = await preservedDesign();
    assert.equal(design.editingMode, "html-text");
    assert.equal(design.assets?.length, 1);
    assert.ok(design.assets![0].sha256);
    assert.match(design.css, /background:#102030 url\("cf-asset:asset-1"\)/);
    const response = withImportedSlidePreviews({ design });
    assert.doesNotMatch(response.previews[0], /base64/);
    const preview = hydrateImportedPreview(response.previews[0], design.assets);
    assert.match(preview, /data:image\/png;base64/);
    assert.doesNotMatch(preview, /cf-asset:/);
    assert.equal(load(design.layouts[0].html)("img").length, 2);
    assert.match(sanitizeImportedCss(`.slide{background:#102030 url('/private') center/cover no-repeat}`), /background:#102030 none center\/cover no-repeat/);
  });

  it("sustituye campos sin perder recursos y separa HTML del editor nativo", async () => {
    const design = await preservedDesign();
    const spec = prepareImportedSlidePackage("Conservar diseño", design);
    const base = spec.examples[0] as unknown as CourseDeckSpec;
    const deck = { ...base, importedDesign: design, slides: [{ ...base.slides[0], title: "Título nuevo", bodyBlocks: [{ kind: "paragraph" as const, text: "Contenido nuevo" }] }] };
    const rendered = renderImportedCourseDeckSource(deck, design);
    assert.match(rendered.slides[0].html, /Título nuevo/);
    assert.match(rendered.slides[0].html, /Contenido nuevo/);
    assert.equal((rendered.css.match(/content:url\("data:image\/png;base64/g) ?? []).length, 1);
    assert.throws(() => buildCourseDeckEditableArtifact(deck), /no se convierte al editor nativo/);
    assert.throws(() => renderCourseDeckHtml({ ...deck, importedDesign: detachedImportedDesign(design) }), /Carga los recursos/);
  });

  it("guarda solo manifiestos en BD y recupera binarios del ZIP con autoridad de organización", async () => {
    const design = await preservedDesign();
    const fixture = createImportCatalogFixture();
    const context = { admin: fixture.admin, organizationId: "organizacion-a", userId: "actor", platformRole: "ADMIN" };
    const saved = await saveImportedSlidePackage(context, "Recursos", design);
    const stored = [...fixture.tables.get("soflia_bundle_specs")!.values()][0].spec_json as { importedDesign: typeof design };
    assert.doesNotMatch(JSON.stringify(stored), /"base64"/);
    assert.equal(stored.importedDesign.resourceBundleRunId, saved.generationRunId);
    const hydrated = await hydrateImportedDesignForOrganization(stored.importedDesign, context);
    assert.equal(hydrated.assets![0].base64, tinyPng);
    assert.equal((await saveImportedSlidePackage(context, "Recursos", hydrated)).reused, true);
    const zip = await JSZip.loadAsync([...fixture.files.values()][0]);
    assert.equal(Object.keys(zip.files).filter(name => /^assets\/asset-.*\.png$/.test(name)).length, 1);
    assert.doesNotMatch(await zip.file("package-spec.json")!.async("string"), /"base64"/);
    assert.match(await zip.file("runtime/design-1.html")!.async("string"), /\.\.\/assets\/asset-1.png/);
    await assert.rejects(hydrateImportedDesignForOrganization(stored.importedDesign, { ...context, organizationId: "organizacion-b" }), /esta organización/);
  });

  it("rechaza MIME falso, SVG activo, referencias cruzadas y binarios alterados", async () => {
    assert.throws(() => normalizeImportedAssets([{ id: "asset-1", mimeType: "font/ttf", base64: tinyPng }]), /validación/);
    for (const svg of ['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><image href="https://example.test/x"/></svg>']) {
      assert.throws(() => normalizeImportedAssets([{ id: "asset-1", mimeType: "image/svg+xml", base64: Buffer.from(svg).toString("base64") }]), /validación/);
    }
    const design = await preservedDesign();
    const altered = structuredClone(design); altered.assets![0].sha256 = "0".repeat(64);
    assert.throws(() => normalizeImportedSlideDesign(altered), /validación/);
    const missing = structuredClone(design); missing.assets = [];
    assert.throws(() => normalizeImportedSlideDesign(missing), /manifiesto/);
    const fontMismatch = structuredClone(design); fontMismatch.css += '@font-face{font-family:x;src:url("cf-asset:asset-1")}';
    assert.throws(() => normalizeImportedSlideDesign(fontMismatch), /manifiesto/);
  });

  it("acota dimensiones y presupuestos decodificados de imágenes y fuentes", () => {
    const invalidSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="-1" height="-1"/>';
    assert.throws(() => normalizeImportedAssets([{ id: "asset-1", mimeType: "image/svg+xml", base64: Buffer.from(invalidSvg).toString("base64") }]), /validación/);
    const png = Buffer.from(tinyPng, "base64");
    png.writeUInt32BE(4096, 16); png.writeUInt32BE(4096, 20);
    assert.throws(() => normalizeImportedAssets([1, 2].map(id => ({ id: `asset-${id}`, mimeType: "image/png", base64: png.toString("base64") }))), /validación/);
    const woff = Buffer.alloc(48);
    woff.write("wOF2"); woff.writeUInt32BE(48, 8); woff.writeUInt16BE(1, 12); woff.writeUInt32BE(15_000_000, 16);
    assert.throws(() => normalizeImportedAssets([1, 2].map(id => ({ id: `asset-${id}`, mimeType: "font/woff2", base64: woff.toString("base64") }))), /validación/);
  });

  it("conserva posiciones CSS originales al envolver texto mixto como campos", () => {
    const source = fixtures[0].replace("</style>", 'strong:last-child{white-space:nowrap}strong:nth-child(2){color:red}[class=":last-child"]{color:blue}</style>')
      .replace("<p>Contenido original</p>", "<p>Texto <strong>énfasis</strong>.</p>");
    const design = analyzeImportedSlideHtml(source, { editingMode: "html-text" }).design;
    const fragment = load(design.layouts[0].html);
    assert.match(fragment("strong").attr("class")!, /cf-source-position-1/);
    assert.doesNotMatch(fragment("strong").attr("class")!, /cf-source-position-2/);
    assert.equal(fragment("strong").is(":last-child"), false);
    assert.match(design.css, /strong\.cf-source-position-1\{white-space:nowrap\}/);
    assert.match(design.css, /\[class=":last-child"\]/);
    const spec = prepareImportedSlidePackage("Texto mixto", design);
    const base = spec.examples[0] as unknown as CourseDeckSpec;
    const mixedFields = design.layouts[0].fields.filter(field => field.role === "body");
    mixedFields.forEach(field => { field.role = "decoration"; });
    mixedFields[0].role = "body";
    const rendered = renderImportedCourseDeckSource({ ...base, slides: [{ ...base.slides[0], bodyBlocks: [{ kind: "paragraph", text: "Nuevo" }] }] }, design);
    assert.match(load(rendered.slides[0].html)("p").html()!, />Nuevo <\/span><strong/);
    assert.equal(load(rendered.slides[0].html)("p").text(), "Nuevo énfasis.");
  });

  it("limita la expansión del ZIP y verifica ruta y checksum antes de hidratar", async () => {
    const design = await preservedDesign();
    const manifest = detachedImportedDesign(design);
    let downloads = 0;
    const zip = new JSZip(); zip.file("assets/asset-1.png", Buffer.alloc(100_000));
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const context = { organizationId: "organizacion-a", storagePath: `template-bundles/organizations/organizacion-a/slide-templates/imports/0000/${"a".repeat(64)}.slide-template.zip`,
      outputHash: createHash("sha256").update(bytes).digest("hex"), admin: { storage: { from() { return { async download() { downloads++; return { data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer }, error: null }; } }; } } } };
    await assert.rejects(hydrateImportedDesignBundle(manifest, { ...context, organizationId: "organizacion-b" }), /organización/);
    assert.equal(downloads, 0);
    await assert.rejects(hydrateImportedDesignBundle(manifest, { ...context, outputHash: "0".repeat(64) }), /integridad/);
    await assert.rejects(hydrateImportedDesignBundle(manifest, context), /tamaño declarado/);
  });
  it("retira comentarios con escapes y conserva combinadores CSS válidos", () => {
    const css = sanitizeImportedCss(String.raw`/* Framework: \3c style> y <section> */ .axis > span{color:red}`);
    assert.equal(css.trim(), ".cf-import-root .axis > span{color:red}");
    assert.throws(() => sanitizeImportedCss(String.raw`.axis\3e span{color:red}`), /escapes/);
    assert.throws(() => sanitizeImportedCss(`.axis{content:"<script>"}`), /incompatibles/);
    assert.throws(() => sanitizeImportedCss(`.axis{color:\u0000red}`), /incompatibles/);
  });

  it("conserva anclas visuales OpenDesign sin conceder identidad editable", async () => {
    const source = fixtures[0].replace("<p>", '<p data-od-id="chart-label" data-courseforge-editable-id="externo">')
      .replace("</style>", '[data-od-id="chart-label"] > span{color:red}</style>');
    const prepared = await prepareImportedSlideFile(new Blob([source]));
    const { design } = analyzeImportedSlideHtml(prepared.html);
    assert.match(design.css, /\[data-cf-design-id="chart-label"\] > span/);
    assert.match(design.layouts[0].html, /data-cf-design-id="chart-label"/);
    assert.doesNotMatch(JSON.stringify(design), /data-od-id|data-courseforge-editable-id/);
    assert.equal(prepareImportedSlidePackage("Anclas visuales", design).importedDesign?.layouts.length, 1);
  });

  it("admite 16 y 24 diseños y rechaza familias mayores", () => {
    for (const count of [16, HTML_SLIDE_IMPORT_LIMITS.slides]) {
      const source = `<html><body>${'<section class="slide"><h1>Título</h1><p>Contenido</p></section>'.repeat(count)}</body></html>`;
      assert.equal(analyzeImportedSlideHtml(source).design.layouts.length, count);
      assert.throws(() => analyzeImportedSlideHtml(source.replace("</body>", `${'<section class="slide"><h1>Extra</h1></section>'.repeat(HTML_SLIDE_IMPORT_LIMITS.slides + 1 - count)}</body>`)), /24 diapositivas/);
    }
  });

  for (const bytes of [21_700_000, 50_000_000, HTML_SLIDE_FILE_LIMITS.bytes]) {
    it(`prepara un original de ${bytes} bytes y envía solo el diseño compacto`, async () => {
      const prefix = fixtures[2].replace("</body></html>", '<img src="data:image/png;base64,');
      const suffix = '"></body></html>';
      const source = new Blob([prefix, Buffer.alloc(bytes - Buffer.byteLength(prefix + suffix), 65), suffix]);
      const progress: number[] = [];
      const result = await prepareImportedSlideFile(source, percent => progress.push(percent));
      assert.equal(result.originalBytes, bytes);
      assert.equal(result.removedResources, 1);
      assert.equal(progress.at(-1), 100);
      assert.ok(progress.every((percent, index) => index === 0 || percent >= progress[index - 1]));
      assert.ok(result.preparedBytes < 2000);
      assert.equal(Buffer.byteLength(result.html), result.preparedBytes);
      assert.doesNotMatch(result.html, /data:image|<img/);
      const design = analyzeImportedSlideHtml(result.html).design;
      assert.match(design.css, /font-size:64px/);
      assert.equal(prepareImportedSlidePackage("Original grande", design).importedDesign?.layouts.length, 1);
      const request = new Request("http://localhost/import", { method: "POST", body: JSON.stringify({ action: "analyze", html: result.html }) });
      assert.equal((await parseImportedSlideRequest(request)).success, true);
    });
  }

  it("rechaza originales mayores de 100 MB antes de leer y diseños reducidos excesivos", async () => {
    const oversized = { size: HTML_SLIDE_FILE_LIMITS.bytes + 1, slice() { throw new Error("No debe leer"); } } as unknown as Blob;
    await assert.rejects(prepareImportedSlideFile(oversized), /100 MB/);
    await assert.rejects(prepareImportedSlideFile(new Blob(["<p>", "x".repeat(HTML_SLIDE_IMPORT_LIMITS.sourceBytes), "</p>"])), /HTML\/CSS sin recursos supera 2 MB/);
    for (const attribute of ["class", "style"]) {
      await assert.rejects(prepareImportedSlideFile(new Blob([`<p ${attribute}="`, "a ".repeat(1_500_000), '">Contenido</p>'])), /HTML\/CSS sin recursos supera 2 MB/);
    }
    await assert.rejects(prepareImportedSlideFile(new Blob([new Uint8Array([0xff])])), /UTF-8/);
    await assert.rejects(prepareImportedSlideFile(new Blob(["<div>".repeat(HTML_SLIDE_FILE_LIMITS.depth + 1)])), /complejidad/);
  });

  it("reduce URLs CSS grandes entre bloques y conserva texto, atributos y SVG", async () => {
    const encoded = "A".repeat(3_000_000);
    const html = fixtures[2].replace("</style>", `.slide{background:url("data:image/png;base64,${encoded}");color:#123456}</style>`)
      .replace("<p>", `<script>window.noEjecutar=1;</script><!-- comentario --><p style="background:url('data:image/png;base64,${encoded}');color:red">`)
      .replace("Explicación educativa", "Explicación &amp; &lt;educativa&gt;");
    const prepared = await prepareImportedSlideFile(new Blob([html]));
    assert.equal(prepared.removedCssUrls, 2);
    assert.equal(prepared.removedScripts, 1);
    assert.doesNotMatch(prepared.html, /data:image|window.noEjecutar|comentario/);
    const result = analyzeImportedSlideHtml(prepared.html);
    assert.match(result.design.layouts[0].html, /<svg/);
    assert.match(result.design.layouts[0].html, /Explicación &amp; &lt;educativa&gt;/);
    assert.match(result.design.css, /color:#123456/);
  });

  it("reconoce URLs CSS y sus comillas aunque cada carácter llegue por separado", () => {
    const chunks: string[] = [];
    let removed = 0;
    const reducer = createImportedCssUrlReducer(chunk => chunks.push(chunk), () => removed++);
    for (const character of `.slide{background:URL ("data:a)b\\\"c");color:red}p{background:url(data:b);font-size:32px}`) reducer.write(character);
    reducer.end();
    assert.equal(removed, 2);
    assert.equal(chunks.join(""), ".slide{background:url();color:red}p{background:url();font-size:32px}");
  });

  it("retira notas extensas sin perder diseños después de etiquetas vacías legadas", async () => {
    const html = fixtures[0].replace("<body>", `<body><basefont><section class="notes">${"x".repeat(3_000_000)}</section>`);
    const prepared = await prepareImportedSlideFile(new Blob([html]));
    assert.ok(prepared.preparedBytes < 2000);
    const { design } = analyzeImportedSlideHtml(prepared.html);
    assert.equal(design.layouts.length, 1);
    assert.equal(design.layouts[0].fields[0].sample, "Portada original");
  });

  it("admite exactamente 2 MB de HTML y rechaza un byte adicional", () => {
    const source = fixtures[0].replace("</script>", `${" ".repeat(HTML_SLIDE_IMPORT_LIMITS.sourceBytes - Buffer.byteLength(fixtures[0]))}</script>`);
    assert.equal(Buffer.byteLength(source), HTML_SLIDE_IMPORT_LIMITS.sourceBytes);
    assert.equal(analyzeImportedSlideHtml(source).design.layouts.length, 1);
    assert.throws(() => analyzeImportedSlideHtml(`${source} `), /2 MB/);
  });

  it("analiza y guarda una familia editable mayor de 500 KB", async () => {
    const path = `M0 0 ${"L1.00000000000000000000001 1.00000000000000000000001 ".repeat(1_000)}`;
    const slide = `<section class="slide"><h1>Título</h1><p>Contenido</p><svg width="240" height="160" viewBox="0 0 240 160"><path d="${path}" /></svg></section>`;
    const source = `<html><head><style>.slide{padding:80px;background:#f5eee0}h1{font-size:64px}p{font-size:32px}</style></head><body>${slide.repeat(10)}</body></html>`;
    assert.ok(Buffer.byteLength(source) > 500_000);
    const result = analyzeImportedSlideHtml(source);
    assert.ok(Buffer.byteLength(JSON.stringify(result.design)) > 500_000);
    const packaged = prepareImportedSlidePackage("Familia amplia", result.design);
    assert.equal(packaged.importedDesign?.layouts.length, 10);
    const response = withImportedSlidePreviews(result);
    assert.equal(response.previews.length, 10);
    assert.ok(Buffer.byteLength(JSON.stringify(response)) < HTML_SLIDE_IMPORT_LIMITS.responseBytes);
    assert.equal(response.previews[0], importedDesignPreview(result.design, 0));
    const catalog = createImportCatalogFixture();
    await saveImportedSlidePackage({ admin: catalog.admin, organizationId: "organizacion-amplia", userId: "actor", platformRole: "ADMIN" }, "Familia amplia", result.design);
    assert.equal([...catalog.tables.get("soflia_bundle_generation_runs")!.values()][0].status, "PACKAGED");
    assert.equal(catalog.files.size, 1);
  });

  it("conserva límites de fragmentos y controla la expansión de previews", () => {
    const design = analyzeImportedSlideHtml(fixtures[0]).design;
    assert.throws(() => withImportedSlidePreviews({ design, report: "x".repeat(HTML_SLIDE_IMPORT_LIMITS.responseBytes) }), /5 MB/);
    design.layouts[0].html = design.layouts[0].html.padEnd(HTML_SLIDE_IMPORT_LIMITS.fragmentCharacters + 1, " ");
    assert.throws(() => normalizeImportedSlideDesign(design));
    assert.throws(() => sanitizeImportedCss(" ".repeat(HTML_SLIDE_IMPORT_LIMITS.cssCharacters + 1)), HtmlSlideImportError);
  });

  it("cuenta bytes UTF-8 del archivo incluso si tiene menos caracteres", async () => {
    const request = (html: string) => new Request("http://localhost/import", { method: "POST", body: JSON.stringify({ action: "analyze", html }) });
    assert.equal((await parseImportedSlideRequest(request("é".repeat(HTML_SLIDE_IMPORT_LIMITS.sourceBytes / 2)))).success, true);
    assert.deepEqual(await parseImportedSlideRequest(request("é".repeat(HTML_SLIDE_IMPORT_LIMITS.sourceBytes / 2 + 1))), { success: false, reason: "too_large" });
    assert.throws(() => analyzeImportedSlideHtml("é".repeat(HTML_SLIDE_IMPORT_LIMITS.sourceBytes / 2 + 1)), /2 MB/);
  });

  it("limita el stream real sin confiar en Content-Length y cancela su lectura", async () => {
    for (const headers of [{}, { "content-length": "10" }]) {
      let canceled = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(HTML_SLIDE_IMPORT_LIMITS.requestBytes + 1).fill(32)); },
        cancel() { canceled = true; },
      });
      const request = new Request("http://localhost/import", { method: "POST", headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
      assert.deepEqual(await parseImportedSlideRequest(request), { success: false, reason: "too_large" });
      assert.equal(canceled, true);
    }
    const declared = new Request("http://localhost/import", { method: "POST", body: "{}", headers: { "content-length": String(HTML_SLIDE_IMPORT_LIMITS.requestBytes + 1) } });
    assert.deepEqual(await parseImportedSlideRequest(declared), { success: false, reason: "too_large" });
    assert.equal(declared.bodyUsed, false);
  });

  it("rechaza JSON/UTF-8 inválidos y familias serializadas mayores de 2 MB", async () => {
    for (const body of ["{", new Uint8Array([0xff])]) {
      assert.deepEqual(await parseImportedSlideRequest(new Request("http://localhost/import", { method: "POST", body })), { success: false, reason: "invalid" });
    }
    const request = new Request("http://localhost/import", { method: "POST", body: JSON.stringify({ action: "save", design: { css: "x".repeat(HTML_SLIDE_IMPORT_LIMITS.designBytes) } }) });
    assert.deepEqual(await parseImportedSlideRequest(request), { success: false, reason: "too_large" });
  });

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
