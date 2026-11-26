import assert from "node:assert/strict";
import test from "node:test";
import { load } from "cheerio";
import { documentFixture } from "./delivery-documents.fixture";
import { buildSessionDeck, sessionDeckIdentity } from "../services/delivery-deck";

test("produce un deck visual real con QA y sin notas o soluciones reservadas", () => {
  const { workspace, id, material } = documentFixture();
  material.slides[0].points = ["Compara las tareas por impacto y urgencia antes de reservar bloques de concentración en la agenda."];
  const output = buildSessionDeck(workspace, id);
  assert.equal(output.qa.status, "PASS", JSON.stringify(output.qa.findings));
  assert.equal(output.deck.sessionId, id);
  assert.equal("materialComponentId" in output.deck, false);
  assert.doesNotMatch(JSON.stringify(output), /RESERVAD|Criterio reservado/);
  assert.equal(load(output.html)("section.slide").length, output.deck.slides.length);
  assert.match(output.html, /deck-next/);
  assert.deepEqual(output.deck.slides[0].validationHints.sourceRefs, ["source"]);
});

test("reintentar es estable y cambiar sesión, tenant, contenido o aprobación invalida la identidad", () => {
  const { workspace, id, material } = documentFixture();
  const original = sessionDeckIdentity(workspace, id).id;
  assert.equal(sessionDeckIdentity(structuredClone(workspace), id).id, original);
  const otherTenant = { ...workspace, organization_id: "otro-tenant" };
  assert.notEqual(sessionDeckIdentity(otherTenant, id).id, original);
  material.slides[0].points.push("Nuevo contenido");
  assert.notEqual(sessionDeckIdentity(workspace, id).id, original);
  assert.throws(() => buildSessionDeck(workspace, "sesion-ajena"), /no tiene materiales/);
});

test("pagina todos los puntos y sus palabras, incluidas más de 24 diapositivas, sin truncamiento", () => {
  const { workspace, id, material } = documentFixture();
  material.slides = Array.from({ length: 40 }, (_, index) => ({ title: `Tema ${index + 1}`, notes: "NOTA_RESERVADA",
    points: Array.from({ length: 6 }, (_, point) => `Punto ${point + 1}: analiza el impacto y acuerda una prioridad antes de reservar tiempo de trabajo.`), sourceRefs: ["source"] }));
  const output = buildSessionDeck(workspace, id);
  assert.ok(output.deck.slides.length > 40);
  assert.equal(output.qa.status, "PASS", JSON.stringify(output.qa.findings));
  const actual = output.deck.slides.flatMap(slide => slide.bodyBlocks.flatMap(block => block.items || [])).join(" ");
  const expected = material.slides.flatMap(slide => slide.points).join(" ");
  assert.equal(actual.replace(/\s+/g, " "), expected.replace(/\s+/g, " "));
});

test("el QA mantiene el rechazo de contenido insuficiente y el renderer escapa HTML", () => {
  const { workspace, id, material } = documentFixture();
  let result = buildSessionDeck(workspace, id);
  assert.equal(result.qa.status, "FAIL");
  assert.ok(result.qa.findings.some(item => item.code === "insufficient_slide_explanation"));
  material.slides[0].points = ["<img src=x onerror=alert(1)> Revisa la prioridad y el impacto de las tareas antes de organizar la agenda diaria."];
  result = buildSessionDeck(workspace, id);
  assert.equal(load(result.html)("img[onerror]").length, 0);
  assert.match(result.html, /&lt;img/);
});

test("redistribuye una frase residual sin perder palabras ni crear una página insuficiente", () => {
  const { workspace, id, material } = documentFixture();
  const point = Array.from({ length: 42 }, () => "tarea").join(" ");
  material.slides[0].points = [point];
  const output = buildSessionDeck(workspace, id);
  assert.equal(output.qa.status, "PASS", JSON.stringify(output.qa.findings));
  assert.equal(output.deck.slides.flatMap(slide => slide.bodyBlocks.flatMap(block => block.items || [])).join(" "), point);
});

test("regresión de staging: la diapositiva 7 no deja aislado su tercer punto", () => {
  const { workspace, id, material } = documentFixture();
  material.slides[0] = { title: "Descomponer y estimar con incertidumbre", notes: "NOTA_RESERVADA", sourceRefs: ["source"], points: [
    "Considerar preparación, ejecución, coordinación, revisión y correcciones.",
    "Registrar optimista ≤ más probable ≤ pesimista.",
    "Distinguir trabajo, espera y reserva; evitar dobles conteos.",
  ] };
  const result = buildSessionDeck(workspace, id);
  assert.equal(result.qa.status, "PASS", JSON.stringify(result.qa.findings));
  assert.equal(result.deck.slides.flatMap(slide => slide.bodyBlocks.flatMap(block => block.items || [])).join(" "), material.slides[0].points.join(" "));
  assert.equal(result.version, "session-deck-v2");
});
