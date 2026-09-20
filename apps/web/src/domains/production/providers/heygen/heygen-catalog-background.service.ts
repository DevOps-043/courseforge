import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import { HeygenCatalogService } from "./heygen-catalog.service";
import { getHeygenClientForOrganization } from "./heygen-credential-resolver.service";

export interface HeygenCatalogBackgroundRequest {
  organizationId: string;
  requestId: string;
  syncRunId: string;
}

export async function runHeygenCatalogBackground(
  request: HeygenCatalogBackgroundRequest,
) {
  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  const auth = await getHeygenClientForOrganization({
    allowGlobalFallback: false,
    organizationId: request.organizationId,
    requestTimeoutMs: 30_000,
    supabase,
  });
  return new HeygenCatalogService({ client: auth.client, supabase })
    .syncCatalog(request.organizationId, request.requestId, request.syncRunId);
}
