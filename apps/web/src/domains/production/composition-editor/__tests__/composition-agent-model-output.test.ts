import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompositionAgentJsonSchema,
  getCompositionAgentProviderJsonSchema,
  normalizeCompactCompositionAgentModelOutput,
  normalizeCompositionAgentModelOutput,
} from "../composition-agent-model-output.types";
import {
  buildGeminiCompositionProposalConfig,
  buildOpenAiCompositionProposalRequest,
} from "../composition-agent-provider.service";

test("normalizes required nullable provider fields without widening persisted operations", () => {
  const patch = normalizeCompositionAgentModelOutput({
    operations: [{
      clipId: "visual-clip",
      layout: { height: null, opacity: 0.8, rotation: null, width: null, x: null, y: null, zIndex: null },
      type: "clip.layout",
    }],
    summary: "Reducirá ligeramente la opacidad.",
  });

  assert.deepEqual(patch.operations[0], { clipId: "visual-clip", layout: { opacity: 0.8 }, type: "clip.layout" });
  assert.equal(patch.source, "AGENT");
});

test("accepts a finite playback preset that lasts longer than an entrance", () => {
  const patch = normalizeCompositionAgentModelOutput({
    operations: [{
      animationId: "motion-pulse-agent",
      clipId: "visual-clip",
      durationSeconds: 6,
      presetId: "PULSE",
      type: "animation.add-preset",
    }],
    summary: "Añadirá un pulso finito durante la reproducción.",
  });

  assert.deepEqual(patch.operations[0], {
    animationId: "motion-pulse-agent",
    clipId: "visual-clip",
    durationSeconds: 6,
    presetId: "PULSE",
    type: "animation.add-preset",
  });
});

test("rejects a provider partial object that contains only null values", () => {
  assert.throws(() => normalizeCompositionAgentModelOutput({
    operations: [{
      settings: { hidden: null, locked: null, muted: null, volume: null },
      trackId: "visual",
      type: "track.update",
    }],
    summary: "No cambiará nada.",
  }));
});

test("decodes a provider's compact operation envelope before authoritative validation", () => {
  const patch = normalizeCompactCompositionAgentModelOutput({
    operations: [{
      argumentsJson: "{\"clipId\":\"visual-clip\",\"hidden\":true}",
      type: "clip.visibility",
    }],
    summary: "Ocultará el clip seleccionado.",
  });

  assert.deepEqual(patch.operations, [{ clipId: "visual-clip", hidden: true, type: "clip.visibility" }]);
  assert.equal(patch.source, "AGENT");
});

test("rejects malformed or type-overriding compact provider arguments", () => {
  assert.throws(() => normalizeCompactCompositionAgentModelOutput({
    operations: [{ argumentsJson: "not-json", type: "clip.visibility" }],
    summary: "Ocultará el clip seleccionado.",
  }));
  assert.throws(() => normalizeCompactCompositionAgentModelOutput({
    operations: [{
      argumentsJson: "{\"clipId\":\"visual-clip\",\"hidden\":true,\"type\":\"clip.move\"}",
      type: "clip.visibility",
    }],
    summary: "Ocultará el clip seleccionado.",
  }));
});

test("builds strict JSON Schema requests for OpenAI and Gemini", () => {
  const schema = getCompositionAgentJsonSchema();
  const openAi = buildOpenAiCompositionProposalRequest({ model: "gpt-5", prompt: "mueve", temperature: 0.2 });
  const gemini = buildGeminiCompositionProposalConfig(0.2);

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["operations", "summary"]);
  assert.equal((openAi.text as { format: { strict: boolean; type: string } }).format.strict, true);
  assert.equal((openAi.text as { format: { strict: boolean; type: string } }).format.type, "json_schema");
  assert.equal(JSON.stringify(openAi).includes("\"oneOf\""), false);
  assert.equal("temperature" in openAi, false);
  assert.equal(gemini.responseMimeType, "application/json");
  assert.deepEqual(gemini.responseJsonSchema, getCompositionAgentProviderJsonSchema());
  const serializedGeminiSchema = JSON.stringify(gemini.responseJsonSchema);
  for (const unsupportedKeyword of ["\"const\"", "\"pattern\"", "\"minLength\"", "\"maxLength\"", "\"exclusiveMinimum\""]) {
    assert.equal(serializedGeminiSchema.includes(unsupportedKeyword), false, `Gemini schema contains ${unsupportedKeyword}`);
  }
  assert.match(serializedGeminiSchema, /"propertyOrdering"/);
  assert.match(serializedGeminiSchema, /"clip\.move"/);
});
