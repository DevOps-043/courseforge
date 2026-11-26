import assert from "node:assert/strict";
import test from "node:test";
import { documentFixture } from "./delivery-documents.fixture";
import { deliverySessionPreview } from "../lib/delivery-session-preview";

test("vista participante y presentación no contienen respuestas o notas reservadas", () => {
  const { workspace, id } = documentFixture();
  for (const audience of ["participant", "presentation"] as const) {
    const output = JSON.stringify(deliverySessionPreview(workspace, id, audience));
    assert.doesNotMatch(output, /RESERVAD|Criterio reservado/);
  }
  const participant = JSON.stringify(deliverySessionPreview(workspace, id, "participant"));
  assert.match(participant, /Presenta el resultado/);
  assert.match(participant, /Lista de verificaciones/);
  assert.doesNotMatch(participant, /Se cubre en Academy/);
});
test("facilitador conserva respuestas, instrumentos y notas en el mismo curso", () => {
  const { workspace, id } = documentFixture();
  const output = JSON.stringify(deliverySessionPreview(workspace, id, "facilitator"));
  for (const value of ["SOLUCION_RESERVADA", "NOTA_RESERVADA", "RESPUESTA_RESERVADA", "Falla de red"]) assert.ok(output.includes(value));
});
test("sesión pendiente o ajena no devuelve contenido de otra sesión; legacy sigue visible", () => {
  const { workspace, id } = documentFixture();
  assert.deepEqual(deliverySessionPreview(workspace, "ajena", "participant"), []);
  delete workspace.document.materials[id].documents;
  assert.match(JSON.stringify(deliverySessionPreview(workspace, id, "participant")), /Concepto/);
  delete workspace.document.plans[id];
  assert.deepEqual(deliverySessionPreview(workspace, id, "participant"), []);
});
