import assert from "node:assert/strict";
import test from "node:test";
import {
  getMaterialsModelProvider,
  isSupportedMaterialsModel,
} from "../materials-model-provider";

test("detecta modelos Gemini para Materiales", () => {
  assert.equal(getMaterialsModelProvider("gemini-3.6-flash"), "gemini");
  assert.equal(getMaterialsModelProvider("gemini-2.5-flash"), "gemini");
});

test("detecta modelos OpenAI para Materiales", () => {
  assert.equal(getMaterialsModelProvider("gpt-5.6-terra"), "openai");
  assert.equal(getMaterialsModelProvider("gpt-4o"), "openai");
  assert.equal(getMaterialsModelProvider("o3-mini"), "openai");
  assert.equal(getMaterialsModelProvider("o1"), "openai");
});

test("rechaza proveedores no implementados", () => {
  assert.equal(getMaterialsModelProvider("claude-example"), null);
  assert.equal(isSupportedMaterialsModel("claude-example"), false);
});
