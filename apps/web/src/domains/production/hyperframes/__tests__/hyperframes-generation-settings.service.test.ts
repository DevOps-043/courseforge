import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_HYPERFRAMES_GENERATION_SETTINGS,
  hyperframesGenerationSettingsSchema,
} from "../hyperframes-generation-settings.service";

describe("HyperFrames generation settings", () => {
  it("uses safe defaults for internal automatic and agent-assisted generation", () => {
    assert.equal(DEFAULT_HYPERFRAMES_GENERATION_SETTINGS.agentAssistedGenerationEnabled, true);
    assert.equal(DEFAULT_HYPERFRAMES_GENERATION_SETTINGS.automaticGenerationEnabled, true);
    assert.equal(DEFAULT_HYPERFRAMES_GENERATION_SETTINGS.temperature, 0.3);
  });

  it("rejects unsafe model configuration values", () => {
    assert.equal(
      hyperframesGenerationSettingsSchema.safeParse({
        agentModel: "",
        temperature: 3,
      }).success,
      false,
    );
  });
});
