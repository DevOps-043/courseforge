import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import { ProductionAutomationDispatcher } from "./production-automation-dispatcher.service";

export async function runProductionAutomationBackground(params: {
  organizationId: string;
  runId: string;
}) {
  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  return new ProductionAutomationDispatcher(supabase).dispatchRun(params);
}
