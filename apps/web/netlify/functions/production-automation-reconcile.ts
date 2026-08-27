import type { Config, Handler } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "../../src/lib/server/env";
import { ProductionAutomationRunService } from "../../src/domains/production/automation/production-automation-run.service";
import { jsonResponse, methodNotAllowedResponse } from "./shared/http";

export const config: Config = { schedule: "*/2 * * * *" };

/** Recovers provider completion without opening the editor or rendering a video. */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  if (event.headers["x-nf-event"] !== "schedule") {
    return jsonResponse({ error: "scheduled_invocation_required" }, 401);
  }

  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  const result = await new ProductionAutomationRunService(supabase).reconcileActiveRuns();
  return jsonResponse({ success: true, ...result });
};
