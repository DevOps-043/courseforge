import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { ArtifactBaseGenerationSchema } from "../artifact-base-generation.schema";

interface JsonSchemaNode {
  additionalProperties?: unknown;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
}

function assertStrictObjectContracts(
  schema: JsonSchemaNode,
  path = "response",
): void {
  if (schema.properties) {
    assert.equal(
      schema.additionalProperties,
      false,
      `${path} must reject undeclared properties`,
    );
    assert.deepEqual(
      new Set(schema.required ?? []),
      new Set(Object.keys(schema.properties)),
      `${path}.required must contain every declared property`,
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
  const jsonSchema = z.toJSONSchema(ArtifactBaseGenerationSchema);

  assertStrictObjectContracts(jsonSchema as unknown as JsonSchemaNode);
});

test("requires resumen while allowing an explicit null value", () => {
  const baseArtifact = {
    nombres: ["Nombre A", "Nombre B", "Nombre C"],
    objetivos: ["Comprender A", "Aplicar B", "Analizar C"],
    descripcion: {
      texto: "Descripción",
      publico_objetivo: "Profesionales",
      beneficios: "Beneficios",
      diferenciador: "Diferenciador",
      resumen: null,
    },
  };

  assert.equal(
    ArtifactBaseGenerationSchema.safeParse(baseArtifact).success,
    true,
  );

  const { resumen: _resumen, ...descripcionSinResumen } =
    baseArtifact.descripcion;
  assert.equal(
    ArtifactBaseGenerationSchema.safeParse({
      ...baseArtifact,
      descripcion: descripcionSinResumen,
    }).success,
    false,
  );
});
