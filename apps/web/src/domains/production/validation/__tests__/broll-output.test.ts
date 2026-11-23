import assert from "node:assert/strict";
import test from "node:test";
import { brollPromptOutputFormat, parseCompletedBrollResponse } from "../broll-prompts.schema";

test("B-roll exige el esquema que el prompt editorial promete al proveedor", () => {
  assert.equal(brollPromptOutputFormat.type, "json_schema");
  assert.equal(brollPromptOutputFormat.strict, true);
  assert.deepEqual(brollPromptOutputFormat.schema.required, ["prompts"]);
  const prompts = [{ scene_index: 3, original_description: "Oficina", generated_prompt: "office, team, planning" }];
  assert.deepEqual(parseCompletedBrollResponse({ status: "completed", output_text: JSON.stringify({ prompts }) }).prompts, prompts);
});
test("B-roll rechaza falta de prompts, vacíos, extras y campos inválidos con diagnóstico seguro", () => {
  for (const value of [{ scenes: [] }, { prompts: [] }, { prompts: [{ scene_index: -1, original_description: "", generated_prompt: "" }] }, { prompts: [], secret: "NO_MOSTRAR" }]) {
    assert.throws(() => parseCompletedBrollResponse({ status: "completed", output_text: JSON.stringify(value) }), error => error instanceof Error && error.message.includes("BROLL_INVALID_OUTPUT") && !error.message.includes("NO_MOSTRAR"));
  }
});
test("B-roll no acepta respuestas truncadas, negativas ni JSON roto", () => {
  assert.throws(() => parseCompletedBrollResponse({ status: "incomplete", output_text: '{"prompts":[]}' }), /BROLL_INCOMPLETE_OUTPUT/);
  assert.throws(() => parseCompletedBrollResponse({ status: "completed", output_text: "" }), /EMPTY_MODEL_RESPONSE/);
  assert.throws(() => parseCompletedBrollResponse({ status: "completed", output_text: "{" }), /INVALID_MODEL_JSON/);
});
