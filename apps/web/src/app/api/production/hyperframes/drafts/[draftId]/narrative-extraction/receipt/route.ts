import { createServerNarrativeExtractionHandlers } from "@/domains/production/composition-editor/http/composition-narrative-extraction-handlers.server";
import { narrativeExtractionPersistenceReady } from "@/domains/production/composition-editor/http/composition-narrative-extraction-rollout.server";

export const runtime = "nodejs";
const handlers = createServerNarrativeExtractionHandlers({ recoveryEnabled: narrativeExtractionPersistenceReady });
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handlers.recover(request, (await context.params).draftId);
}
