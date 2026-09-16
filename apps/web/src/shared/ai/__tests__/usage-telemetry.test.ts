import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordGeminiUsage, recordOpenAiUsage } from "../usage-telemetry";

function telemetryClient(rows: Array<Record<string, unknown>>) {
  return {
    from(table: string) {
      assert.equal(table, "ai_usage_events");
      return {
        async upsert(row: Record<string, unknown>) {
          rows.push(row);
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("AI usage telemetry", () => {
  it("captures the complete OpenAI token breakdown with a stable event key", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const response = {
      id: "resp_123",
      output: [{ type: "web_search_call" }, { type: "message" }],
      status: "completed",
      usage: {
        input_tokens: 120,
        input_tokens_details: { cached_tokens: 40 },
        output_tokens: 50,
        output_tokens_details: { reasoning_tokens: 12 },
        total_tokens: 170,
      },
    };

    await recordOpenAiUsage({
      context: { operation: "search_lesson_sources", pipelineStep: "CURATION" },
      model: "gpt-test",
      response,
      startedAt: Date.now(),
      supabase: telemetryClient(rows),
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_key, "openai:resp_123");
    assert.equal(rows[0].input_tokens, 120);
    assert.equal(rows[0].cached_input_tokens, 40);
    assert.equal(rows[0].output_tokens, 50);
    assert.equal(rows[0].reasoning_tokens, 12);
    assert.equal(rows[0].web_search_calls, 1);
    assert.equal("prompt" in rows[0], false);
    assert.equal("response" in rows[0], false);
  });

  it("maps Gemini usage metadata without persisting generated content", async () => {
    const rows: Array<Record<string, unknown>> = [];
    await recordGeminiUsage({
      context: { operation: "generate_syllabus", pipelineStep: "SYLLABUS" },
      model: "gemini-test",
      response: {
        responseId: "gemini-response-1",
        text: "sensitive generated content",
        usageMetadata: {
          cachedContentTokenCount: 20,
          candidatesTokenCount: 80,
          promptTokenCount: 200,
          thoughtsTokenCount: 10,
          totalTokenCount: 280,
        },
      },
      startedAt: Date.now(),
      supabase: telemetryClient(rows),
    });

    assert.equal(rows[0].event_key, "gemini:gemini-response-1");
    assert.equal(rows[0].total_tokens, 280);
    assert.doesNotMatch(JSON.stringify(rows[0]), /sensitive generated content/);
  });
});
