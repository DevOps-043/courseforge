import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtifactBaseProgress } from "../../../app/admin/artifacts/[id]/ArtifactBaseProgress";
import type { ArtifactViewRecord } from "../../../app/admin/artifacts/[id]/artifact-view.types";

const artifact: ArtifactViewRecord = {
  id: "curso", course_id: "DOC-curso", created_at: "2026-11-11", state: "GENERATING",
  generation_metadata: { base_progress: { phase: "reading", confirmed: 16, total: 23 } },
};

test("Base muestra avance guardado y distingue una consulta fallida de un trabajo terminado", () => {
  const render = (current: ArtifactViewRecord, syncFailed = false) =>
    renderToStaticMarkup(createElement(ArtifactBaseProgress, { artifact: current, syncFailed, showResult: true }));
  const active = render(artifact);
  assert.match(active, /Leyendo las fuentes/);
  assert.match(active, /16 de 23 lotes guardados/);
  assert.match(active, /<progress/);
  assert.doesNotMatch(active, /Ya puedes/);
  assert.match(render(artifact, true), /último estado disponible/);

  const stopped = render({
    ...artifact, state: "ESCALATED",
    validation_report: { results: [{ code: "GENERATION_FAILED", passed: false, message: "Pendiente" }] },
  });
  assert.match(stopped, /La generación de Base se detuvo/);
  assert.match(stopped, /Ya puedes recargar o reintentar/);
  assert.doesNotMatch(stopped, /<progress/);
  assert.match(render({ ...artifact, state: "APPROVED" }), /Base disponible/);
});
