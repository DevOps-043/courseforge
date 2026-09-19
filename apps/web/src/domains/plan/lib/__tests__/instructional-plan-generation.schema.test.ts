import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { GeneratedInstructionalPlanSchema } from "../instructional-plan-generation.schema";
import { buildInstructionalPlanContextPrompt } from "../instructional-plan-prompt";
import { resolveInstructionalPlanAudience } from "../instructional-plan-validation-context";
import { getInstructionalPlanCompletenessIssues } from "../plan-completeness";

interface JsonSchemaObject {
  additionalProperties?: boolean;
  items?: JsonSchemaObject;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
}

function assertStrictObjectContracts(schema: JsonSchemaObject, path = "root") {
  if (schema.properties) {
    assert.deepEqual(
      [...(schema.required || [])].sort(),
      Object.keys(schema.properties).sort(),
      `${path} must require every declared property`,
    );
    assert.equal(
      schema.additionalProperties,
      false,
      `${path} must reject undeclared properties`,
    );

    for (const [propertyName, propertySchema] of Object.entries(
      schema.properties,
    )) {
      assertStrictObjectContracts(propertySchema, `${path}.${propertyName}`);
    }
  }

  if (schema.items) {
    assertStrictObjectContracts(schema.items, `${path}[]`);
  }
}

test("emits an OpenAI-compatible strict JSON schema", () => {
  const jsonSchema = z.toJSONSchema(
    GeneratedInstructionalPlanSchema,
  ) as JsonSchemaObject;
  assertStrictObjectContracts(jsonSchema);
});

test("accepts nullable pedagogical fields while keeping every key present", () => {
  const parsed = GeneratedInstructionalPlanSchema.parse({
    lesson_plans: [
      {
        lesson_id: "lesson-1",
        lesson_title: "Leccion",
        lesson_order: 1,
        module_id: "module-1",
        module_title: "Modulo",
        module_index: 0,
        oa_text: "Analizar riesgos",
        oa_bloom_verb: null,
        measurable_criteria: null,
        course_type_detected: null,
        components: [{ type: "READING", summary: "Lectura guiada." }],
        alignment_notes: null,
      },
    ],
    blockers: [],
  });

  assert.equal(parsed.lesson_plans[0]?.oa_bloom_verb, null);
  assert.deepEqual(parsed.blockers, []);
});

test("requires a one-to-one lesson mapping between syllabus and plan", () => {
  const modules = [{ lessons: [{ id: "lesson-1" }, { id: "lesson-2" }] }];
  assert.deepEqual(
    getInstructionalPlanCompletenessIssues(modules, [
      { lesson_id: "lesson-1" },
      { lesson_id: "lesson-2" },
    ]),
    [],
  );
  const issues = getInstructionalPlanCompletenessIssues(modules, [
    { lesson_id: "lesson-1" },
    { lesson_id: "lesson-1" },
  ]);
  assert.ok(issues.some((issue) => issue.includes("Faltan lecciones")));
  assert.ok(issues.some((issue) => issue.includes("repite identificadores")));
});

test("uses the company prompt until an explicit per-generation edit is enabled", () => {
  const configuredPrompt = "PROMPT EMPRESARIAL ${courseName}";
  const customPrompt = "PROMPT MODIFICADO: prioriza simulaciones";

  assert.equal(
    buildInstructionalPlanContextPrompt({
      configuredPrompt,
      customPrompt,
      useCustomPrompt: false,
    }),
    configuredPrompt,
  );
  assert.equal(
    buildInstructionalPlanContextPrompt({
      configuredPrompt,
      customPrompt,
      useCustomPrompt: true,
    }),
    customPrompt,
  );
});

test("reads the validation audience from current artifact JSON fields", () => {
  assert.equal(
    resolveInstructionalPlanAudience({
      descripcion: { publico_objetivo: "Líderes técnicos" },
      generation_metadata: {
        original_input: { targetAudience: "Audiencia original" },
      },
    }),
    "Líderes técnicos",
  );
  assert.equal(
    resolveInstructionalPlanAudience({
      generation_metadata: {
        original_input: { targetAudience: "Gerentes de producto" },
      },
    }),
    "Gerentes de producto",
  );
  assert.equal(resolveInstructionalPlanAudience({}), "General");
});
