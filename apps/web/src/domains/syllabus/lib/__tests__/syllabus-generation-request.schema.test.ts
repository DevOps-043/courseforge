import assert from "node:assert/strict";
import test from "node:test";
import {
  syllabusGenerationBackgroundRequestSchema,
  syllabusGenerationRequestSchema,
} from "../../syllabus-generation-request.schema";

const validRequest = {
  artifactId: "8d15ec09-d2ae-4f24-a565-84c337f6c135",
  ideaCentral: "Fundamentos de seguridad de aplicaciones",
  objetivos: ["Identificar límites de confianza"],
  route: "A_WITH_SOURCE" as const,
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

