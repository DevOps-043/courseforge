import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordOpenAiUsage } from "../usage-telemetry";

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

});
