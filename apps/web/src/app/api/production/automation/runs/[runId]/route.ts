import { NextResponse } from "next/server";
import {
  canReviewContent,
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { getErrorMessage } from "@/lib/errors";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  ProductionAutomationRunError,
  ProductionAutomationRunService,
} from "@/domains/production/automation/production-automation-run.service";
import { createClient } from "@/utils/supabase/server";

async function getAuthorizedService() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  const tenant = await resolveActiveTenantContext();
  if (!tenant || !(await canReviewContent(user.userId, tenant))) {
    return { error: NextResponse.json({ error: "No tienes permisos para consultar produccion." }, { status: 403 }) };
  }
  return { service: new ProductionAutomationRunService(getServiceRoleClient()), tenant };
}

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const authorized = await getAuthorizedService();
    if ("error" in authorized) return authorized.error;
    const { runId } = await context.params;
    const result = await authorized.service.getRun(runId, authorized.tenant.organizationId);
    return NextResponse.json({ success: true, data: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return respond(error);
  }
}

/** Re-evaluates persisted assets; it does not enqueue, compose, or render media. */
export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const authorized = await getAuthorizedService();
    if ("error" in authorized) return authorized.error;
    const { runId } = await context.params;
    const result = await authorized.service.refreshRun(runId, authorized.tenant.organizationId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return respond(error);
  }
}

function respond(error: unknown) {
  if (error instanceof ProductionAutomationRunError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[API /production/automation/runs/:runId] Unexpected error:", error);
  return NextResponse.json({ error: getErrorMessage(error, "No se pudo consultar la automatizacion.") }, { status: 500 });
}
