import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_HYPERFRAMES_GENERATION_SETTINGS,
  getHyperframesGenerationSettings,
  hyperframesGenerationSettingsSchema,
} from "../hyperframes-generation-settings.service";

describe("HyperFrames generation settings", () => {
  it("uses safe defaults for internal automatic and agent-assisted generation", () => {
    assert.equal(DEFAULT_HYPERFRAMES_GENERATION_SETTINGS.agentAssistedGenerationEnabled, true);
    assert.equal(DEFAULT_HYPERFRAMES_GENERATION_SETTINGS.automaticGenerationEnabled, true);
    assert.equal(DEFAULT_HYPERFRAMES_GENERATION_SETTINGS.agentModel, "gemini-3.5-flash");
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

  it("allows supported Gemini and GPT models but rejects arbitrary provider names", () => {
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gemini-2.5-flash" }).success, true);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gemini-3.6-flash" }).success, true);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gemini-2.0-flash" }).success, false);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gpt-4.1-mini" }).success, true);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gpt-5.6-terra" }).success, true);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "o3-mini" }).success, true);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gpt-unlisted-model" }).success, false);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gpt-5.6-terra", fallbackModel: "gemini-3.5-flash" }).success, true);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gpt-5.6-terra", fallbackModel: "gpt-5.6-terra" }).success, false);
    assert.equal(hyperframesGenerationSettingsSchema.safeParse({ agentModel: "gpt-5.6-terra", fallbackModel: "unknown-model" }).success, false);
  });

  it("returns the model persisted for the requested organization without replacing it with the default", async () => {
    const observedFilters: Array<[string, string]> = [];
    const query = {
      eq(column: string, value: string) {
        observedFilters.push([column, value]);
        return this;
      },
      async maybeSingle() {
        return {
          data: {
            agent_assisted_generation_enabled: true,
            agent_model: "gpt-5.6-terra",
            automatic_generation_enabled: true,
            fallback_model: "gemini-3.5-flash",
            temperature: 0.3,
          },
          error: null,
        };
      },
      select() { return this; },
    };
    const supabase = {
      from(table: string) {
        assert.equal(table, "video_composition_generation_settings");
        return query;
      },
    };

    const settings = await getHyperframesGenerationSettings({
      organizationId: "organization-a",
      supabase: supabase as never,
    });

    assert.equal(settings.agentModel, "gpt-5.6-terra");
    assert.equal(settings.fallbackModel, "gemini-3.5-flash");
    assert.deepEqual(observedFilters, [["organization_id", "organization-a"]]);
  });
});
