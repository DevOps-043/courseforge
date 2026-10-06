import { createServerNarrativeFragmentCommandHandlers } from "@/domains/production/composition-editor/http/composition-narrative-fragment-command-handlers.server";
import { narrativeFragmentApplyEnabled, narrativeFragmentPersistenceReady, narrativeFragmentOrganizationEnabled } from "@/domains/production/composition-editor/http/composition-narrative-fragment-rollout.server";

export const runtime = "nodejs";
const handlers = createServerNarrativeFragmentCommandHandlers({ enabled: narrativeFragmentApplyEnabled,
  recoveryEnabled: narrativeFragmentPersistenceReady, organizationEnabled: narrativeFragmentOrganizationEnabled });
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handlers.apply(request, (await context.params).draftId);
}
