import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";

export type AiUsagePeriod = "day" | "month" | "week";

export interface AiUsageSummary {
  actual_cost_usd: number | null;
  cached_input_tokens: number;
  estimated_cost_usd: number | null;
  failed_requests: number;
  input_tokens: number;
  last_event_at: string | null;
  output_tokens: number;
  reasoning_tokens: number;
  requests: number;
  total_tokens: number;
  web_search_calls: number;
}

export interface AiUsageBucket extends Omit<AiUsageSummary, "last_event_at" | "reasoning_tokens"> {
  bucket_start: string;
}

export interface AiUsageBreakdown {
  estimated_cost_usd?: number | null;
  failed_requests: number;
  pipeline_step?: string;
  provider?: string;
  requests: number;
  total_tokens: number;
  web_search_calls: number;
}

export interface AiUsageDashboardData {
  buckets: AiUsageBucket[];
  by_provider: AiUsageBreakdown[];
  by_step: AiUsageBreakdown[];
  summary: AiUsageSummary;
}

const EMPTY_DATA: AiUsageDashboardData = {
  buckets: [],
  by_provider: [],
  by_step: [],
  summary: {
    actual_cost_usd: null,
    cached_input_tokens: 0,
    estimated_cost_usd: null,
    failed_requests: 0,
    input_tokens: 0,
    last_event_at: null,
    output_tokens: 0,
    reasoning_tokens: 0,
    requests: 0,
    total_tokens: 0,
    web_search_calls: 0,
  },
};

export function resolveAiUsageWindow(period: AiUsagePeriod, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  if (period === "day") start.setUTCDate(start.getUTCDate() - 1);
  if (period === "week") start.setUTCDate(start.getUTCDate() - 7);
  if (period === "month") start.setUTCMonth(start.getUTCMonth() - 1);
  return {
    bucket: period === "month" ? "week" : period === "week" ? "day" : "day",
    end: end.toISOString(),
    start: start.toISOString(),
  } as const;
}

export async function loadAiUsageDashboard(period: AiUsagePeriod) {
  const supabase = createAdminClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const window = resolveAiUsageWindow(period);
  const { data, error } = await supabase.rpc("get_ai_usage_dashboard", {
    p_bucket: window.bucket,
    p_end: window.end,
    p_start: window.start,
  });
  if (error) {
    return {
      data: EMPTY_DATA,
      error: error.message,
      window,
    };
  }
  return {
    data: (data || EMPTY_DATA) as AiUsageDashboardData,
    error: null,
    window,
  };
}
