import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { getAppUrl } from "@/lib/server/env";
import { createNarrativeFragmentPlanHttpHandler } from "@/domains/production/composition-editor/http/composition-narrative-fragment-plan-handler.server";
import { authorizeServerNarrativeExtraction } from "@/domains/production/composition-editor/http/composition-narrative-extraction-handlers.server";
import { createNarrativeFragmentReadRepository } from "@/domains/production/composition-editor/composition-narrative-fragment.repository";
import { consumeNarrativeExtractionRateLimit } from "@/domains/production/composition-editor/composition-narrative-extraction-rate-limit";

const plan = createNarrativeFragmentPlanHttpHandler({
  configuredAppUrl: getAppUrl,
  authorize: authorizeServerNarrativeExtraction,
  consumeRateLimit: (scope, signal) => consumeNarrativeExtractionRateLimit({ ...scope, purpose: "PLAN",
    consume: policy => getServiceRoleClient().rpc("consume_api_rate_limit", policy).retry(false).abortSignal(signal) }),
  createRepository: signal => createNarrativeFragmentReadRepository(getServiceRoleClient(), signal),
});

export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return plan(request, (await context.params).draftId);
}
