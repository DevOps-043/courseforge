import assert from "node:assert/strict";
import test from "node:test";
import {
  syllabusGenerationBackgroundRequestSchema,
  syllabusGenerationRequestSchema,
} from "../../syllabus-generation-request.schema";
import { syllabusManagementRequestSchema } from "../../syllabus-management-request.schema";
import { buildSyllabusGenerationPrompt } from "../syllabus-generation";

const validRequest = {
  artifactId: "8d15ec09-d2ae-4f24-a565-84c337f6c135",
  ideaCentral: "Fundamentos de seguridad de aplicaciones",
  objetivos: ["Identificar límites de confianza"],
  route: "B_NO_SOURCE" as const,
};

const sourceDocument = {
  characterCount: 71,
  fileId: "066ff6c2-b66f-4f9d-bf2c-a7e5a340a3df",
  filename: "manual.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
  sizeBytes: 2048,
  text: "Contenido principal del manual para construir el temario del curso.",
};

test("the syllabus request requires a tenant-authorizable artifact", () => {
  assert.equal(syllabusGenerationRequestSchema.safeParse(validRequest).success, true);
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      artifactId: undefined,
    }).success,
    false,
  );
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      artifactId: "not-a-uuid",
    }).success,
    false,
  );
});

test("the syllabus request rejects unbounded or unknown input", () => {
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      objetivos: Array.from({ length: 21 }, (_, index) => `Objetivo ${index}`),
    }).success,
    false,
  );
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      unexpected: true,
    }).success,
    false,
  );
});

test("the syllabus request accepts a bounded per-generation prompt override", () => {
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      promptOverride: "Prioriza casos prácticos del sector financiero.",
    }).success,
    true,
  );
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      promptOverride: "x".repeat(40_001),
    }).success,
    false,
  );
});

test("an edited prompt reaches the final model prompt with required runtime context", () => {
  const finalPrompt = buildSyllabusGenerationPrompt({
    promptTemplate: "REGLA ÚNICA DE PRUEBA: prioriza laboratorios.",
    ideaCentral: "Modelos GPT",
    objetivos: ["Comparar modelos GPT"],
    route: "B_NO_SOURCE",
    researchContext: "Contexto investigado",
  });

  assert.match(finalPrompt, /REGLA ÚNICA DE PRUEBA: prioriza laboratorios/);
  assert.match(finalPrompt, /Modelos GPT/);
  assert.match(finalPrompt, /Comparar modelos GPT/);
  assert.match(finalPrompt, /Contexto investigado/);
  assert.match(finalPrompt, /Responde únicamente con JSON válido/);
  assert.match(finalPrompt, /exactamente 1 módulos/);
  assert.match(finalPrompt, /entre 3 y 6 lecciones/);
  assert.match(finalPrompt, /máximo 12 horas/);
});

test("document-based generation requires one or more bounded source documents", () => {
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      route: "A_WITH_SOURCE",
    }).success,
    false,
  );
  assert.equal(
    syllabusGenerationRequestSchema.safeParse({
      ...validRequest,
      route: "A_WITH_SOURCE",
      sourceDocuments: [sourceDocument],
    }).success,
    true,
  );
});

test("only the signed background contract accepts a reserved iteration", () => {
  assert.equal(
    syllabusGenerationBackgroundRequestSchema.safeParse({
      ...validRequest,
      iterationNumber: 2,
    }).success,
    true,
  );
  assert.equal(
    syllabusGenerationBackgroundRequestSchema.safeParse({
      ...validRequest,
      iterationNumber: 0,
    }).success,
    false,
  );
});

test("syllabus management accepts bounded server-side mutations", () => {
  assert.equal(
    syllabusManagementRequestSchema.safeParse({
      action: "status",
      artifactId: validRequest.artifactId,
      state: "STEP_APPROVED",
      notes: "Revisado",
    }).success,
    true,
  );
  assert.equal(
    syllabusManagementRequestSchema.safeParse({
      action: "modules",
      artifactId: validRequest.artifactId,
      modules: [{
        objective_general_ref: "Comprender los fundamentos",
        title: "Módulo 1",
        lessons: [{
          title: "Lección 1",
          objective_specific: "El participante será capaz de explicar los fundamentos.",
          estimated_minutes: 12,
        }],
      }],
    }).success,
    true,
  );
  assert.equal(
    syllabusManagementRequestSchema.safeParse({
      action: "modules",
      artifactId: validRequest.artifactId,
      modules: [],
    }).success,
    false,
  );
});
