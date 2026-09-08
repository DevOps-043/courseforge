import assert from "node:assert/strict";
import test from "node:test";
import {
  CURATION_SEARCH_RESPONSE_SCHEMA,
  createCurationBatchResponseSchema,
} from "../structured-output.schemas";

interface JsonSchemaNode {
  additionalProperties?: unknown;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: readonly string[];
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

test("batch curation schema remains strict at every object level", () => {
  const schema = createCurationBatchResponseSchema(4);

  assertStrictObjectContracts(schema as unknown as JsonSchemaNode);
  assert.equal(schema.properties.lessons.items.properties.sources.maxItems, 4);
});

test("curation search schema remains strict at every object level", () => {
  assertStrictObjectContracts(
    CURATION_SEARCH_RESPONSE_SCHEMA as unknown as JsonSchemaNode,
  );
});
