import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AiProvider = "gemini" | "openai";
export type AiUsageStatus = "failed" | "incomplete" | "succeeded";

export interface AiUsageContext {
  artifactId?: string | null;
  attempt?: number;
  lessonId?: string | null;
  operation: string;
  organizationId?: string | null;
  pipelineStep: string;
  runId?: string | null;
  userId?: string | null;
}

interface UsageEventInput extends AiUsageContext {
  cachedInputTokens?: number | null;
  errorCode?: string | null;
  inputTokens?: number | null;
  latencyMs?: number | null;
  model: string;
  outputTokens?: number | null;
  provider: AiProvider;
  providerRequestId?: string | null;
  reasoningTokens?: number | null;
  status: AiUsageStatus;
  totalTokens?: number | null;
  webSearchCalls?: number | null;
}

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function errorCode(error: unknown) {
  if (typeof error !== "object" || !error) return "UNKNOWN";
  if ("code" in error && error.code) return String(error.code).slice(0, 120);
  if ("status" in error && error.status) return `HTTP_${String(error.status)}`;
  return error instanceof Error ? error.name.slice(0, 120) : "UNKNOWN";
}

export async function recordAiUsageEvent(
  supabase: SupabaseClient | null | undefined,
  event: UsageEventInput,
) {
  if (!supabase) return;

  const inputTokens = safeCount(event.inputTokens);
  const outputTokens = safeCount(event.outputTokens);
  const totalTokens = safeCount(event.totalTokens) || inputTokens + outputTokens;
  const eventKey = event.providerRequestId
    ? `${event.provider}:${event.providerRequestId}`
    : `${event.provider}:${crypto.randomUUID()}`;

  try {
    const { error } = await supabase.from("ai_usage_events").upsert(
      {
        artifact_id: event.artifactId || null,
        attempt: Math.max(1, Math.trunc(event.attempt || 1)),
        cached_input_tokens: safeCount(event.cachedInputTokens),
        error_code: event.errorCode || null,
        event_key: eventKey,
        input_tokens: inputTokens,
        latency_ms: event.latencyMs == null ? null : safeCount(event.latencyMs),
        lesson_id: event.lessonId || null,
        model: event.model,
        operation: event.operation,
        organization_id: event.organizationId || null,
        output_tokens: outputTokens,
        pipeline_step: event.pipelineStep,
        provider: event.provider,
        provider_request_id: event.providerRequestId || null,
        reasoning_tokens: safeCount(event.reasoningTokens),
        run_id: event.runId || null,
        status: event.status,
        total_tokens: totalTokens,
        user_id: event.userId || null,
        web_search_calls: safeCount(event.webSearchCalls),
      },
      { onConflict: "event_key", ignoreDuplicates: true },
    );
    if (error) {
      console.warn("[AIUsage] Could not persist usage event", {
        message: error.message,
        operation: event.operation,
        provider: event.provider,
      });
    }
  } catch (error) {
    console.warn("[AIUsage] Usage persistence unavailable", {
      message: error instanceof Error ? error.message : String(error),
      operation: event.operation,
      provider: event.provider,
    });
  }
}

export async function recordOpenAiUsage(params: {
  context: AiUsageContext;
  model: string;
  response: unknown;
  startedAt: number;
  supabase?: SupabaseClient | null;
}) {
  const response = params.response as {
    id?: string;
    output?: Array<{ type?: string }>;
    status?: string;
    usage?: {
      input_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
      total_tokens?: number;
    };
  };
  const status: AiUsageStatus = response.status === "incomplete"
    ? "incomplete"
    : response.status === "failed"
      ? "failed"
      : "succeeded";

  await recordAiUsageEvent(params.supabase, {
    ...params.context,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens,
    inputTokens: response.usage?.input_tokens,
    latencyMs: Date.now() - params.startedAt,
    model: params.model,
    outputTokens: response.usage?.output_tokens,
    provider: "openai",
    providerRequestId: response.id,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens,
    status,
    totalTokens: response.usage?.total_tokens,
    webSearchCalls: response.output?.filter((item) => item.type === "web_search_call").length,
  });
}

export async function recordGeminiUsage(params: {
  context: AiUsageContext;
  model: string;
  response: unknown;
  startedAt: number;
  supabase?: SupabaseClient | null;
}) {
  const response = params.response as {
    responseId?: string;
    usageMetadata?: {
      cachedContentTokenCount?: number;
      candidatesTokenCount?: number;
      promptTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const usage = response.usageMetadata;

  await recordAiUsageEvent(params.supabase, {
    ...params.context,
    cachedInputTokens: usage?.cachedContentTokenCount,
    inputTokens: usage?.promptTokenCount,
    latencyMs: Date.now() - params.startedAt,
    model: params.model,
    outputTokens: usage?.candidatesTokenCount,
    provider: "gemini",
    providerRequestId: response.responseId,
    reasoningTokens: usage?.thoughtsTokenCount,
    status: "succeeded",
    totalTokens: usage?.totalTokenCount,
  });
}

export async function recordAiFailure(params: {
  context: AiUsageContext;
  error: unknown;
  model: string;
  provider: AiProvider;
  startedAt: number;
  supabase?: SupabaseClient | null;
}) {
  await recordAiUsageEvent(params.supabase, {
    ...params.context,
    errorCode: errorCode(params.error),
    latencyMs: Date.now() - params.startedAt,
    model: params.model,
    provider: params.provider,
    status: "failed",
  });
}

export async function recordAiSdkUsage(params: {
  context: AiUsageContext;
  model: string;
  startedAt: number;
  supabase?: SupabaseClient | null;
  usage: unknown;
}) {
  const usage = params.usage as {
    cachedInputTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  const provider: AiProvider = /^(gpt-|o\d)/i.test(params.model)
    ? "openai"
    : "gemini";
  await recordAiUsageEvent(params.supabase, {
    ...params.context,
    cachedInputTokens: usage.cachedInputTokens,
    inputTokens: usage.inputTokens,
    latencyMs: Date.now() - params.startedAt,
    model: params.model,
    outputTokens: usage.outputTokens,
    provider,
    reasoningTokens: usage.reasoningTokens,
    status: "succeeded",
    totalTokens: usage.totalTokens,
  });
}
