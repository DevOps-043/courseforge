import { NextResponse } from "next/server";
import { z } from "zod";
import {
  canReviewContent,
  getAuthenticatedUser,
  getAuthorizedArtifactAdminForTenant,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { getErrorMessage } from "@/lib/errors";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  ProductionAutomationRunError,
  ProductionAutomationRunService,
} from "@/domains/production/automation/production-automation-run.service";
import { createClient } from "@/utils/supabase/server";

const createRunSchema = z.object({ artifactId: z.string().uuid() }).strict();

/** Returns an active run so the review can resume after a client interruption. */
export async function GET(request: Request) {
  try {
    const artifactId = new URL(request.url).searchParams.get("artifactId");
    if (!artifactId || !z.string().uuid().safeParse(artifactId).success) {
      return NextResponse.json({ error: "artifactId invalido." }, { status: 400 });
    }
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return NextResponse.json({ error: "No tienes permisos para consultar produccion." }, { status: 403 });
    }
    const { data, error } = await getServiceRoleClient()
      .from("production_runs")
      .select("id")
      .eq("artifact_id", artifactId)
      .eq("organization_id", tenant.organizationId)
      .in("status", ["PLANNING", "GENERATING", "PARTIALLY_READY", "NEEDS_ATTENTION"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ success: true, data: data || null }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[API /production/automation/runs] GET error:", error);
    return NextResponse.json({ error: getErrorMessage(error, "No se pudo consultar la automatizacion.") }, { status: 500 });
  }
}

/** Creates or refreshes an asset-generation run. It never renders a video. */
export async function POST(request: Request) {
  try {
    const input = createRunSchema.parse(await request.json().catch(() => ({})));
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return NextResponse.json({ error: "No tienes permisos para automatizar produccion." }, { status: 403 });
    }
    const authorized = await getAuthorizedArtifactAdminForTenant(input.artifactId, tenant);
    if (!authorized || authorized.artifact.organization_id !== tenant.organizationId) {
      return NextResponse.json({ error: "Curso no encontrado para esta empresa." }, { status: 404 });
    }

    const service = new ProductionAutomationRunService(authorized.admin);
    const result = await service.createRun({
      artifactId: input.artifactId,
      createdBy: user.userId,
      organizationId: tenant.organizationId,
    });
    return NextResponse.json({ success: true, data: result }, { status: 202 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Payload invalido para automatizar produccion." }, { status: 400 });
    }
    if (error instanceof ProductionAutomationRunError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[API /production/automation/runs] Unexpected error:", error);
    return NextResponse.json({ error: getErrorMessage(error, "No se pudo iniciar la automatizacion.") }, { status: 500 });
  }
}
