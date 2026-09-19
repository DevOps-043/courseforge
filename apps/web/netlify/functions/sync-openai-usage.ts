import type { Config, Handler } from "@netlify/functions";
import {
  createServiceRoleClient,
  getOptionalOpenAiAdminConfig,
} from "./shared/bootstrap";
import { jsonResponse, methodNotAllowedResponse } from "./shared/http";

export const config: Config = { schedule: "23 * * * *" };

interface UsageResult {
  input_tokens?: number;
  output_tokens?: number;
}

interface CostResult {
  amount?: { currency?: string; value?: number };
  line_item?: string | null;
  project_id?: string | null;
}

interface Bucket<T> {
  end_time: number;
  results?: T[];
  start_time: number;
}

interface OpenAiPage<T> {
  data?: Array<Bucket<T>>;
  has_more?: boolean;
  next_page?: string | null;
}

function adminHeaders(config: ReturnType<typeof getOptionalOpenAiAdminConfig>) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.adminKey}`,
  };
  if (config.organizationId) headers["OpenAI-Organization"] = config.organizationId;
  if (config.projectId) headers["OpenAI-Project"] = config.projectId;
  return headers;
}

async function fetchAllPages<T>(
  pathname: string,
  parameters: URLSearchParams,
  config: ReturnType<typeof getOptionalOpenAiAdminConfig>,
) {
  const pages: Array<Bucket<T>> = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams(parameters);
    if (cursor) query.set("page", cursor);
    const response = await fetch(`https://api.openai.com/v1${pathname}?${query}`, {
      headers: adminHeaders(config),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`OpenAI admin API returned HTTP ${response.status}`);
    }
    const page = await response.json() as OpenAiPage<T>;
    pages.push(...(page.data || []));
    cursor = page.has_more ? page.next_page || null : null;
  } while (cursor);
  return pages;
}

function utcDate(unixSeconds: number) {
  return new Date(unixSeconds * 1_000).toISOString().slice(0, 10);
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  if (event.headers["x-nf-event"] !== "schedule") {
    return jsonResponse({ error: "scheduled_invocation_required" }, 401);
  }

  const adminConfig = getOptionalOpenAiAdminConfig();
  if (!adminConfig.adminKey) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: "OPENAI_ADMIN_KEY_NOT_CONFIGURED" }),
    };
  }

  try {
    const endTime = Math.floor(Date.now() / 1_000);
    const startTime = endTime - 3 * 24 * 60 * 60;
    const common = new URLSearchParams({
      bucket_width: "1d",
      end_time: String(endTime),
      limit: "4",
      start_time: String(startTime),
    });
    const [costBuckets, usageBuckets] = await Promise.all([
      fetchAllPages<CostResult>("/organization/costs", common, adminConfig),
      fetchAllPages<UsageResult>("/organization/usage/completions", common, adminConfig),
    ]);
    const supabase = createServiceRoleClient();

    const costRows = costBuckets.flatMap((bucket) =>
      (bucket.results || [])
        .filter((result) => result.amount?.currency?.toLowerCase() === "usd")
        .map((result) => ({
          amount_usd: result.amount?.value || 0,
          line_item: result.line_item || null,
          project_id: result.project_id || null,
          provider: "openai",
          source: "openai_organization_costs",
          synced_at: new Date().toISOString(),
          usage_date: utcDate(bucket.start_time),
        })),
    );
    if (costRows.length > 0) {
      const { error } = await supabase.from("ai_provider_cost_daily").upsert(costRows, {
        onConflict: "provider,usage_date,project_id,line_item,source",
      });
      if (error) throw error;
    }

    for (const bucket of usageBuckets) {
      const usageDate = utcDate(bucket.start_time);
      const providerInputTokens = (bucket.results || []).reduce((sum, item) => sum + (item.input_tokens || 0), 0);
      const providerOutputTokens = (bucket.results || []).reduce((sum, item) => sum + (item.output_tokens || 0), 0);
      const rangeStart = new Date(`${usageDate}T00:00:00.000Z`).toISOString();
      const rangeEnd = new Date(new Date(rangeStart).getTime() + 86_400_000).toISOString();
      const { data: localEvents, error: localError } = await supabase
        .from("ai_usage_events")
        .select("input_tokens, output_tokens, estimated_cost_usd")
        .eq("provider", "openai")
        .gte("occurred_at", rangeStart)
        .lt("occurred_at", rangeEnd);
      if (localError) throw localError;
      const localInputTokens = (localEvents || []).reduce((sum, item) => sum + Number(item.input_tokens || 0), 0);
      const localOutputTokens = (localEvents || []).reduce((sum, item) => sum + Number(item.output_tokens || 0), 0);
      const localEstimatedCost = (localEvents || []).reduce((sum, item) => sum + Number(item.estimated_cost_usd || 0), 0);
      const actualCost = costRows
        .filter((row) => row.usage_date === usageDate)
        .reduce((sum, row) => sum + Number(row.amount_usd || 0), 0);
      const variance = providerInputTokens + providerOutputTokens > 0
        ? ((localInputTokens + localOutputTokens - providerInputTokens - providerOutputTokens) /
          (providerInputTokens + providerOutputTokens)) * 100
        : null;
      const { error } = await supabase.from("ai_usage_reconciliation").upsert({
        local_estimated_cost_usd: localEstimatedCost || null,
        local_input_tokens: localInputTokens,
        local_output_tokens: localOutputTokens,
        provider: "openai",
        provider_actual_cost_usd: actualCost || null,
        provider_input_tokens: providerInputTokens,
        provider_output_tokens: providerOutputTokens,
        reconciled_at: new Date().toISOString(),
        usage_date: usageDate,
        variance_percent: variance,
      }, { onConflict: "provider,usage_date" });
      if (error) throw error;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ costs: costRows.length, days: usageBuckets.length, success: true }),
    };
  } catch (error) {
    console.error("[OpenAIUsageSync] Sync failed", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "OPENAI_USAGE_SYNC_FAILED", success: false }),
    };
  }
};
