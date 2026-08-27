import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import { canReviewContent, getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { runProductionAutomationBackground } from "@/domains/production/automation/production-automation-background.service";
import { createClient } from "@/utils/supabase/server";

/** Explicit post-review dispatch. This only creates configured source assets. */
export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant || !(await canReviewContent(user.userId, tenant))) {
      return NextResponse.json({ error: "No tienes permisos para iniciar produccion." }, { status: 403 });
    }
    const { runId } = await context.params;
    await callBackgroundFunctionJson(
      "production-automation-background",
      signBackgroundPayload({ organizationId: tenant.organizationId, runId }),
      {
        fallbackError: "No se pudo iniciar el despachador de assets.",
        localHandlerLoader: async () => ({
          handler: async () => {
            await runProductionAutomationBackground({ organizationId: tenant.organizationId, runId });
            return { statusCode: 200, body: JSON.stringify({ success: true }) };
          },
        }),
      },
    );
    return NextResponse.json({ success: true, submissionStatus: "QUEUED" }, { status: 202 });
  } catch (error) {
    console.error("[API /production/automation/runs/:runId/dispatch] Unexpected error:", error);
    return NextResponse.json({ error: getErrorMessage(error, "No se pudo iniciar la produccion.") }, { status: 500 });
  }
}
