import { test } from "node:test";
import assert from "node:assert/strict";
import { generatedSessionMaterialsSchema, sessionMaterialsSchema } from "../types/delivery.schemas";
import { buildSessionDocuments } from "../services/delivery-documents";
import { deliveryReadiness } from "../services/delivery-readiness";
import { materialIssues } from "../lib/delivery-policy";
import { buildEnginePreparation } from "../services/delivery-live-payload";
import { renderDeliveryExport } from "../services/delivery-export";
import { documentFixture } from "./delivery-documents.fixture";
import { z } from "zod";
import { deliveryHash } from "../lib/delivery-hash";

test("nueva generación exige documentos y conserva lectura anterior", () => {
  const { material } = documentFixture();
  assert.equal(generatedSessionMaterialsSchema.safeParse(material).success, true);
  const { documents, ...legacy } = material;
  void documents;
  assert.equal(sessionMaterialsSchema.safeParse(legacy).success, true);
  assert.equal(generatedSessionMaterialsSchema.safeParse(legacy).success, false);
  const contract = z.toJSONSchema(generatedSessionMaterialsSchema);
  assert.ok(contract.required?.includes("documents"));
});
test("deriva 14 entregables con aplicabilidad y secciones reservadas", () => {
  const { workspace, session, plan, material, context } = documentFixture();
  const documents = buildSessionDocuments(workspace, session, plan, material, context);
  assert.equal(documents.length, 14);
  assert.equal(new Set(documents.map(item => item.kind)).size, 14);
  assert.doesNotMatch(JSON.stringify(documents.flatMap(item => item.participant_sections)), /RESERVAD/);
  const excluded = documents.find(item => item.kind === "follow_up")!;
  assert.equal(excluded.applicable, false);
  assert.ok(excluded.reason);
  assert.deepEqual(excluded.participant_sections, []);
});
test("valida instrumentos, fuentes y contingencias", () => {
  const { plan, material } = documentFixture();
  assert.deepEqual(materialIssues(plan, material, ["source"]), []);
  material.documents!.instruments[0].activityId = "ajena";
  material.documents!.contingencies[0].blockId = "ajeno";
  material.documents!.instruments[0].sourceRefs = ["ajena"];
  assert.equal(materialIssues(plan, material, ["source"]).length, 3);
});
test("cambiar documento, plan o fuentes invalida aprobación", () => {
  const { workspace, context, material, plan } = documentFixture();
  assert.equal(deliveryReadiness(workspace.document, context).documentsReady, true);
  material.documents!.instruments[0].feedback = "Revisado";
  assert.equal(deliveryReadiness(workspace.document, context).documentsReady, false);
  plan.blocks[0].explanation = "Otra explicación";
  assert.equal(deliveryReadiness(workspace.document, context).planReady, false);
  const independent = documentFixture();
  independent.context.sources[0].title = "Fuente revisada";
  assert.equal(deliveryReadiness(independent.workspace.document, independent.context).documentsReady, false);
});
test("paquete incluye documentos y HTML público excluye soluciones", () => {
  const { workspace, id, context } = documentFixture();
  const payload = buildEnginePreparation(workspace, id, { organization_slug: "empresa", session_id: id, course_id: id }, id, context);
  assert.equal(payload.manifest.preparation?.documents?.length, 14);
  assert.doesNotMatch(renderDeliveryExport(workspace, context, "participant"), /RESERVAD/);
  assert.match(renderDeliveryExport(workspace, context, "facilitator"), /RESPUESTA_RESERVADA/);
});
test("condicional aplicable exige contenido", () => {
  const { material } = documentFixture();
  material.documents!.jobAid.content = "";
  assert.equal(generatedSessionMaterialsSchema.safeParse(material).success, false);
});
test("material aprobado anterior conserva su estado y señala documentos pendientes", () => {
  const { workspace, context, material } = documentFixture();
  delete material.documents;
  workspace.document.materialsApproval!.content = deliveryHash(workspace.document.materials);
  const readiness = deliveryReadiness(workspace.document, context);
  assert.equal(readiness.materialsReady, true);
  assert.equal(readiness.documentsReady, false);
});
test("el formato de registro admite el rango de campos de autoría sin truncar", () => {
  const { workspace, material, session, plan, context } = documentFixture();
  material.documents!.recordTemplate.sessionFields = Array.from({ length: 20 }, () => "Campo ".repeat(300));
  assert.equal(generatedSessionMaterialsSchema.safeParse(material).success, true);
  const documents = buildSessionDocuments(workspace, session, plan, material, context);
  assert.ok(documents.find(item => item.kind === "record_template")!.facilitator_sections[0].body.length > 8000);
});
