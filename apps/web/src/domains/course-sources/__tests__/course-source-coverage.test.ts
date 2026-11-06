import assert from "node:assert/strict";
import test from "node:test";
import {
  proposeSourceAssociations,
  sourceCoverage,
  type SourceAssociation,
  type SourceEvidence,
  type SourceLesson,
} from "../course-source-coverage";
import { sourceReviewCommandSchema } from "../course-source-review.schema";
const lessons: SourceLesson[] = [
  {
    id: "lesson-1",
    title: "Seguridad",
    webRequired: 2,
    requirements: [
      { id: "objective", label: "Validar identidad" },
      { id: "topic:0", label: "Control de permisos" },
    ],
  },
  {
    id: "lesson-2",
    title: "Auditoría",
    webRequired: 3,
    requirements: [{ id: "objective", label: "Registrar eventos" }],
  },
];
const evidence: SourceEvidence[] = [
  {
    id: "doc",
    type: "DOCUMENT",
    title: "Manual",
    text: "Validar identidad y control de permisos. Registrar eventos para auditoría.",
  },
  {
    id: "url",
    type: "WEB",
    lessonId: "lesson-1",
    title: "Web",
    text: "Control de permisos",
  },
];
const association = (
  patch: Partial<SourceAssociation> = {},
): SourceAssociation => ({
  lessonId: "lesson-1",
  evidenceId: "doc",
  evidenceType: "DOCUMENT",
  requirementIds: ["objective", "topic:0"],
  verified: true,
  conflict: false,
  resolution: "",
  ...patch,
});
test("un manual cubre varias lecciones sin exigir dos archivos", () => {
  const result = sourceCoverage(
    "DOCUMENTS_ONLY",
    lessons,
    [
      association(),
      association({ lessonId: "lesson-2", requirementIds: ["objective"] }),
    ],
    evidence,
  );
  assert.ok(result.every((item) => item.complete));
  assert.ok(result.every((item) => item.webNeeded === 0));
});
test("propuestas, conflictos sin resolver y evidencia ajena no acreditan cobertura", () => {
  for (const patch of [
    { verified: false },
    { conflict: true },
    { evidenceId: "inexistente" },
    { evidenceId: "url", evidenceType: "WEB" as const, lessonId: "lesson-2" },
  ]) {
    const result = sourceCoverage(
      "DOCUMENTS_ONLY",
      lessons,
      [association(patch)],
      evidence,
    );
    assert.ok(result.some((item) => !item.complete));
  }
});
test("mixto busca solo vacíos y una URL revisada complementa sin desplazar el manual", () => {
  const partial = association({ requirementIds: ["objective"] });
  assert.equal(
    sourceCoverage("DOCUMENTS_AND_WEB", lessons, [partial], evidence)[0]
      .webNeeded,
    1,
  );
  const complete = sourceCoverage(
    "DOCUMENTS_AND_WEB",
    lessons,
    [
      partial,
      association({
        evidenceId: "url",
        evidenceType: "WEB",
        requirementIds: ["topic:0"],
      }),
    ],
    evidence,
  )[0];
  assert.equal(complete.complete, true);
  assert.equal(complete.documentCovered, 1);
  assert.equal(complete.webCovered, 1);
});
test("sugerencias deterministas nunca se marcan verificadas y no inventan coincidencias", () => {
  const proposed = proposeSourceAssociations(lessons, evidence);
  assert.ok(proposed.length);
  assert.ok(proposed.every((item) => !item.verified));
  assert.deepEqual(
    proposeSourceAssociations(
      [
        {
          ...lessons[0],
          title: "XYZ",
          requirements: [{ id: "objective", label: "Inexistente" }],
        },
      ],
      evidence,
    ),
    [],
  );
});
test("comandos rechazan autoridad y aprobación sin versión", () => {
  assert.equal(
    sourceReviewCommandSchema.safeParse({ action: "approve" }).success,
    false,
  );
  assert.equal(
    sourceReviewCommandSchema.safeParse({ action: "propose", reviewer: true })
      .success,
    false,
  );
});

test("una URL sin identidad de lección no se convierte en evidencia general", () => {
  const unscoped:SourceEvidence[]=[{id:"url",type:"WEB",title:"Legada",text:"Validar identidad y control de permisos"}];
  const result=sourceCoverage("DOCUMENTS_AND_WEB",lessons,[association({evidenceId:"url",evidenceType:"WEB"})],unscoped);
  assert.equal(result[0].complete,false);
  assert.deepEqual(proposeSourceAssociations(lessons,unscoped),[]);
});
