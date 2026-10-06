import { createServerNarrativeExtractionHandlers } from "@/domains/production/composition-editor/http/composition-narrative-extraction-handlers.server";
import { narrativeExtractionApplyEnabled, narrativeExtractionPersistenceReady, narrativeExtractionOrganizationEnabled } from "@/domains/production/composition-editor/http/composition-narrative-extraction-rollout.server";

export const runtime = "nodejs";
const handlers = createServerNarrativeExtractionHandlers({ enabled: narrativeExtractionApplyEnabled,
  recoveryEnabled: narrativeExtractionPersistenceReady, organizationEnabled: narrativeExtractionOrganizationEnabled });
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handlers.apply(request, (await context.params).draftId);
}
