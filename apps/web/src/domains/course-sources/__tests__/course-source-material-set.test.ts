import assert from "node:assert/strict";
import test from "node:test";
import { materialSourceSetAvailability, isUsableMaterialWebSource } from "../course-source-material-set";
import type { SourceEvidence } from "../course-source-coverage";
import { sourceReviewCommandSchema } from "../course-source-review.schema";

const lessons = [{ id: "one", title: "Primera", webRequired: 2, requirements: [{ id: "objective", label: "Aprender" }] }];
const web = (id: string, lessonId = "one"): SourceEvidence => ({ id, type: "WEB", lessonId, title: id, text: "Contenido válido", sourceRef: `https://example.com/${id}` });
test("conjunto automático conserva todas las fuentes y no requiere asociaciones manuales", () => {
  const result = materialSourceSetAvailability("DOCUMENTS_AND_WEB", true, lessons, [web("a"), web("b"), web("c")]);
  assert.equal(result.ready, true); assert.equal(result.webSources, 3); assert.equal(result.lessonCounts[0].web, 3);
});
test("fuentes de otra lección o sin texto no completan el mínimo", () => {
  assert.equal(materialSourceSetAvailability("DOCUMENTS_AND_WEB", true, lessons, [web("a"), web("b", "other"), { ...web("c"), text: "" }]).ready, false);
  assert.equal(materialSourceSetAvailability("DOCUMENTS_ONLY", true, lessons, [web("a"), web("b")]).ready, false);
});
test("todos los fragmentos documentales siguen disponibles y el plan debe estar aprobado", () => {
  const evidence: SourceEvidence[] = [1,2].map(n => ({ id: String(n), type: "DOCUMENT", title: "Manual", text: "Contenido" }));
  assert.equal(materialSourceSetAvailability("DOCUMENTS_ONLY", true, lessons, evidence).documentFragments, 2);
  assert.equal(materialSourceSetAvailability("DOCUMENTS_ONLY", true, lessons, evidence).ready, true);
  assert.equal(materialSourceSetAvailability("DOCUMENTS_ONLY", false, lessons, evidence).ready, false);
});
test("no se admite título como contenido ni referencias privadas con firma o credenciales", () => {
  assert.equal(isUsableMaterialWebSource("", "https://example.com"), false);
  for (const url of ["http://example.com", "https://user:pass@example.com", "https://example.com?token=secret", "https://example.com#fragment", "javascript:alert(1)"]) assert.equal(isUsableMaterialWebSource("Contenido", url), false);
  assert.equal(isUsableMaterialWebSource("Contenido", "https://example.com/source"), true);
});

test("continuación versionada no acepta IDs elegidos, roles o revisión humana en el payload", () => {
  const command = { action: "use-all", expectedRevision: 2, curriculumHash: "a".repeat(32) };
  assert.equal(sourceReviewCommandSchema.safeParse(command).success, true);
  for (const extra of [{ evidenceIds: ["selected"] }, { reviewer: true }, { approved: true }, { organizationId: "other" }]) {
    assert.equal(sourceReviewCommandSchema.safeParse({ ...command, ...extra }).success, false);
  }
});
