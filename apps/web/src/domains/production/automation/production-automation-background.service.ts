import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import { ProductionAutomationDispatcher } from "./production-automation-dispatcher.service";
import { ProductionAutomationRunService } from "./production-automation-run.service";
import { createOperationalLogger } from "@/lib/server/operational-logger";

export async function runProductionAutomationBackground(params: {
  organizationId: string;
  runId: string;
}) {
  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  const dispatched = await new ProductionAutomationDispatcher(supabase).dispatchRun(params);
  // También cubre cursos cuyos assets ya estaban listos antes de aprobar el perfil.
  try {
    await new ProductionAutomationRunService(supabase).refreshRun(params.runId, params.organizationId);
  } catch {
    // El envío pudo completarse: un error de refresco no autoriza repetir jobs pagados.
    createOperationalLogger("produccion.subtitulos", params)
      .warn("El envío terminó, pero queda pendiente actualizar el estado de producción.");
  }
  return dispatched;
}
