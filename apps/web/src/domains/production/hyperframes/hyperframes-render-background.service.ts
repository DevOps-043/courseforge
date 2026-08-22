import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import { getHyperframesClientForOrganization } from "./hyperframes-credential-resolver.service";
import { HyperframesRenderSubmissionService } from "./hyperframes-render-submission.service";

export async function runHyperframesRenderBackground(renderRequestId: string) {
  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  const { data: request, error: requestError } = await supabase
    .from("hyperframes_render_requests")
    .select("id, organization_id")
    .eq("id", renderRequestId)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!request?.organization_id) throw new Error("HyperFrames render request not found");

  const fallbackService = new HyperframesRenderSubmissionService(supabase);
  try {
    const auth = await getHyperframesClientForOrganization({
      allowGlobalFallback: false,
      organizationId: request.organization_id,
      supabase,
    });
    const service = new HyperframesRenderSubmissionService(supabase, auth.client);
    await service.resume({
      organizationId: request.organization_id,
      requestId: request.id,
    });
  } catch (error) {
    await fallbackService.failDispatch({
      error,
      organizationId: request.organization_id,
      requestId: request.id,
    });
    console.error("[HyperFrames Render Background] Failed:", {
      message: getErrorMessage(error, "Unknown render worker error"),
      requestId: request.id,
    });
    throw error;
  }
}
