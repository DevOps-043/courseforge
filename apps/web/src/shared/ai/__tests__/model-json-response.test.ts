import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelJsonResponseError,
  parseModelJsonResponse,
} from "../model-json-response";

test("parses provider JSON without extracting a greedy substring", () => {
  const parsed = parseModelJsonResponse<{ components: object }>({
    responseText: '{"components":{"READING":{"html":"<p>Contenido</p>"}}}',
  });

  assert.deepEqual(parsed, {
    components: { READING: { html: "<p>Contenido</p>" } },
  });
});

test("keeps compatibility with fenced legacy responses", () => {
  assert.deepEqual(
    parseModelJsonResponse({ responseText: '```json\n{"ok":true}\n```' }),
    { ok: true },
  );
});

test("classifies token-limited output as truncated before parsing", () => {
  assert.throws(
    () =>
      parseModelJsonResponse({
        finishReason: "MAX_TOKENS",
        responseText: '{"components":',
      }),
    (error) =>
      error instanceof ModelJsonResponseError &&
      error.code === "TRUNCATED_MODEL_JSON",
  );
});

test("does not repair or accept malformed JSON", () => {
  assert.throws(
    () => parseModelJsonResponse({ responseText: '{"items":["bad\\q"]}' }),
    (error) =>
      error instanceof ModelJsonResponseError &&
      error.code === "INVALID_MODEL_JSON",
  );
});
