import { NextResponse } from "next/server";
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { CompositionAgentProposalStoreError } from "@/domains/production/composition-editor/composition-agent-proposal-store.service";
import { createClient } from "@/utils/supabase/server";

export async function authorizeCompositionAgentRequest() {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const tenant = await resolveActiveTenantContext();
  if (!tenant) return NextResponse.json({ error: "Empresa no válida o no autorizada." }, { status: 403 });
  if (!(await canReviewContent(user.userId, tenant))) {
    return NextResponse.json({ error: "No tienes permisos para editar videos." }, { status: 403 });
  }
  return { admin: getServiceRoleClient(), organizationId: tenant.organizationId, userId: user.userId };
}

export function compositionAgentStoreErrorResponse(error: CompositionAgentProposalStoreError) {
  return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.status });
}
