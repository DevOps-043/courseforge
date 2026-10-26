import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.COURSE_DELIVERY_PLAYWRIGHT_PATH || "playwright");
const { renderDeliveryExport } = require(resolve("apps/web/.tmp/course-delivery-tests/src/domains/course-delivery/services/delivery-export.js"));
const { emptyDeliveryDocument } = require(resolve("apps/web/.tmp/course-delivery-tests/src/domains/course-delivery/types/delivery.schemas.js"));
const output = resolve(".tmp/course-delivery-qa");
await mkdir(output, { recursive: true });
const document = emptyDeliveryDocument();
document.config.mode = "SYNCHRONOUS";
document.agenda = [{ id: "session-1", title: "Decisiones fundamentadas en evidencia", minutes: 90, objectives: ["Justificar una decisión con evidencia suficiente."], evidence: "Caso escrito", coverage: [{ lessonId: "lesson-1", scope: "Aplicación", review: false }] }];
document.plans["session-1"] = { blocks: [{ id: "case", minutes: 90, purpose: "Aplicación y retroalimentación", explanation: "Compare dos alternativas y explique qué evidencia cambiaría su decisión.", activity: "Resolver el caso de la organización.", criteria: ["Justifica la alternativa"], resources: ["Caso y plantilla"] }], nexusLinks: [] };
document.materials["session-1"] = {
  concepts: [{ title: "La evidencia conecta afirmaciones y decisiones", explanation: "Una recomendación debe distinguir hechos observados, supuestos y criterios de decisión.", example: "Antes de elegir una alternativa, compare el alcance y la calidad de sus fuentes.", misconceptions: ["Más datos no siempre significan mejor evidencia."], sourceRefs: ["source-1"] }],
  activities: [{ id: "case", title: "Caso: priorizar una mejora", instructions: "Elija una de las dos alternativas y escriba qué información sustenta su decisión. Identifique un supuesto que necesite comprobar.", template: "Alternativa elegida:\nEvidencia disponible:\nSupuesto pendiente:\nPróxima acción:", answer: "RESPUESTA_PRIVADA: no existe una alternativa universal; se valora la justificación.", criteria: ["Distingue hecho y supuesto", "Conecta evidencia y decisión"], sourceRefs: ["source-1"] }],
  preparation: { understand: "Comprender la diferencia entre observación, interpretación y decisión.", explain: "Explicar el concepto usando el ejemplo del caso.", conduct: "Pedir una respuesta escrita y contrastar los supuestos del grupo.", deepen: "Consultar la fuente aprobada antes de impartir.", expand: "¿Qué dato podría cambiar la decisión inicial?" },
  slides: [{ title: "Decidir con evidencia", points: ["Identifica el hecho observado", "Explicita el supuesto", "Justifica tu decisión"], notes: "NOTA_PRIVADA: invite al grupo a comparar sus razonamientos.", sourceRefs: ["source-1"] }, { title: "Del análisis a la práctica", points: ["Resuelve el caso por escrito", "Contrasta la evidencia", "Revisa tus supuestos"], notes: "Conceda tiempo de trabajo individual antes de compartir.", sourceRefs: ["source-1"] }],
};
const workspace = { artifact_id: "fixture", organization_id: "fixture", revision: 7, document };
const context = { title: "Taller de pensamiento crítico", syllabusHash: "fixture", sources: [{ id: "source-1", title: "Fuente aprobada para el taller", reference: "https://example.com/source" }] };
const browser = await chromium.launch({ headless: true, ...(process.env.COURSE_DELIVERY_BROWSER_CHANNEL ? { channel: process.env.COURSE_DELIVERY_BROWSER_CHANNEL } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const audience of ["presentation", "facilitator", "participant"]) {
    const html = renderDeliveryExport(workspace, context, audience);
    await writeFile(resolve(output, audience + ".html"), html);
    await page.setContent(html);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (audience === "participant") assert.ok(!await page.getByText(/RESPUESTA_PRIVADA|NOTA_PRIVADA/).count());
    await page.screenshot({ path: resolve(output, audience + ".png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: resolve(output, audience + "-print.pdf"), format: "A4", printBackground: true });
    await page.emulateMedia({ media: "screen" });
  }
  console.log("QA de tres exportaciones: escritorio, ancho móvil, proyección privada e impresión A4. Evidencia en " + output);
} finally { await browser.close(); }
