import { NextResponse } from "next/server";
import { getErrorMessage } from "@/lib/errors";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { HyperframesConnectionService } from "@/domains/production/hyperframes/hyperframes-connection.service";
import { ProductionProviderCredentialError } from "@/domains/production/providers/credentials/provider-credentials.service";
import { createClient } from "@/utils/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    if (!(await canReviewContent(user.userId))) return NextResponse.json({ error: "No tienes permisos para validar HyperFrames Cloud." }, { status: 403 });
    const tenant = await resolveActiveTenantContext();
    if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
    const service = new HyperframesConnectionService(getServiceRoleClient());
    const status = await service.validateActiveApiKey(tenant.organizationId);
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    if (error instanceof ProductionProviderCredentialError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    console.error("[API /production/hyperframes/connection/validate] Unexpected error:", { message: getErrorMessage(error) });
    return NextResponse.json({ error: "No se pudo validar la conexión de HyperFrames Cloud." }, { status: 500 });
  }
}
