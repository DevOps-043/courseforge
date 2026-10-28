import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { APP_CONFIG } from "../app";
import { escapeBrandingHtml } from "../branding-html";

const requireModule = createRequire(__filename);

test("la identidad pública es inmutable y sus recursos existen", () => {
  assert.ok(Object.isFrozen(APP_CONFIG));
  assert.ok(Object.isFrozen(APP_CONFIG.logo));
  assert.ok(Object.isFrozen(APP_CONFIG.assistant));
  assert.ok(APP_CONFIG.name.length > 0 && APP_CONFIG.name.length <= 80);
  assert.match(APP_CONFIG.logo.src, /^\/(?!\/)/);
  assert.ok(existsSync(resolve("apps/web/public", APP_CONFIG.logo.src.slice(1))));
  assert.ok(existsSync(resolve("apps/web/public", APP_CONFIG.iconSrc.slice(1))));
  assert.ok(!existsSync("apps/web/src/app/icon.png"), "El icono debe depender de metadata y configuración, sin prioridad de una convención de archivo.");
  assert.match(APP_CONFIG.supportEmail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  const configSource = readFileSync("apps/web/src/config/app.ts", "utf8");
  assert.doesNotMatch(configSource, /process\.env|server-only|require\(/);
});

test("una identidad alternativa se propaga a prompts, proveedor y schema sin cambiar contratos", () => {
  // Sustituir solo el export CommonJS en esta suite; la configuración de producción es inmutable.
  const brandingModule = requireModule("../app") as { APP_CONFIG: typeof APP_CONFIG };
  const original = brandingModule.APP_CONFIG;
  brandingModule.APP_CONFIG = { ...original, name: 'Academia <Nova> & "Equipo"', shortName: "Nova", supportEmail: "soporte@nova.example", assistant: { name: "Guía", displayName: "Guía IA" } };
  try {
    const { APP_CONTEXT } = requireModule("../../lib/lia-app-context") as { APP_CONTEXT: string };
    const { curationPromptDefault } = requireModule("../../shared/config/prompts/pipeline.prompts") as { curationPromptDefault: string };
    const { getProductionProvider } = requireModule("../../domains/production/providers/production-provider-registry");
    const { courseDeckDesignSystemSchema, COURSE_DECK_SCHEMA_VERSION } = requireModule("../../domains/production/slides/specs/course-deck.schema");
    assert.ok(APP_CONTEXT.includes(brandingModule.APP_CONFIG.name));
    assert.ok(APP_CONTEXT.includes("Eres Guía,"));
    assert.ok(curationPromptDefault.includes(brandingModule.APP_CONFIG.name));
    assert.equal(getProductionProvider("soflia_engine_slides").name, `${brandingModule.APP_CONFIG.name} Slides`);
    assert.equal(getProductionProvider("soflia_engine_slides").key, "soflia_engine_slides");
    assert.equal(courseDeckDesignSystemSchema.parse({}).brandLabel, brandingModule.APP_CONFIG.name);
    assert.equal(courseDeckDesignSystemSchema.parse({ brandLabel: "Marca histórica" }).brandLabel, "Marca histórica");
    assert.equal(COURSE_DECK_SCHEMA_VERSION, "course-deck-v1");
    const privacy = requireModule("../../app/privacy/page");
    const { renderToStaticMarkup } = requireModule("react-dom/server");
    const html = renderToStaticMarkup(privacy.default());
    assert.equal(privacy.metadata.title, `Politica de Privacidad | ${brandingModule.APP_CONFIG.name}`);
    assert.ok(html.includes(escapeBrandingHtml(brandingModule.APP_CONFIG.name)));
    assert.ok(html.includes('href="mailto:soporte@nova.example"'));
    assert.ok(!html.includes(original.name));
  } finally {
    brandingModule.APP_CONFIG = original;
  }
});

test("OAuth escapa la marca y conserva el canal de integración", async () => {
  const brandingModule = requireModule("../app") as { APP_CONFIG: typeof APP_CONFIG };
  const original = brandingModule.APP_CONFIG;
  brandingModule.APP_CONFIG = { ...original, name: '<script>alert("marca")</script> & Nova' };
  try {
    const { oauthPopupResponse } = requireModule("../../lib/server/oauth-popup-response");
    for (const status of ["success", "error"]) {
      const response = oauthPopupResponse({ provider: "google_drive", status, requestId: "branding-test" });
      const html = await response.text();
      assert.ok(html.includes(escapeBrandingHtml(brandingModule.APP_CONFIG.name)));
      assert.ok(!html.includes(brandingModule.APP_CONFIG.name));
      assert.ok(html.includes('type: "courseforge:cloud-storage-oauth"'));
      assert.ok(html.includes("window.location.origin"));
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
  } finally {
    brandingModule.APP_CONFIG = original;
  }
});

test("el escape HTML preserva texto y neutraliza caracteres de marcado", () => {
  assert.equal(escapeBrandingHtml('A&B <C> "D" \'E\''), "A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;");
  assert.equal(escapeBrandingHtml("Academia Ñ"), "Academia Ñ");
});

test("las superficies activas no reintroducen nombres de producto literales", () => {
  const violations: string[] = [];
  const allowedLiterals = new Map([
    ["apps/web/src/config/app.ts", new Set([APP_CONFIG.name])],
    // Prefijo de almacenamiento conservado por compatibilidad; no es presentación.
    ["apps/web/src/domains/production/cloud-storage/artifact-folders.ts", new Set(["`SofLIA - Engine - ${"])],
    ["apps/web/src/lib/server/video-metadata.service.ts", new Set(["Mozilla/5.0 Courseforge/1.0"])],
  ]);
  function visitDirectory(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        if (!["__tests__", "qa", "node_modules"].includes(entry.name)) visitDirectory(file);
        continue;
      }
      if (!/\.tsx?$/.test(file) || /\.test\./.test(file)) continue;
      const source = readFileSync(file, "utf8");
      const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      function visitNode(node: ts.Node) {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
          const text = ts.isStringLiteral(node) ? node.text : node.getText(tree);
          if (/SofLIA\s+(?:-\s*)?Engine|\bCourse[Ff]orge(?![\w:/-])/.test(text) && !allowedLiterals.get(file)?.has(text)) {
            violations.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`);
          }
        }
        ts.forEachChild(node, visitNode);
      }
      visitNode(tree);
    }
  }
  visitDirectory("apps/web/src");
  visitDirectory("apps/web/netlify/functions");
  assert.deepEqual(violations, [], "Centralizar la marca o justificar una excepción técnica específica.");
});
