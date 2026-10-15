import { createServerNarrativeFragmentCommandHandlers } from "@/domains/production/composition-editor/http/composition-narrative-fragment-command-handlers.server";
import { narrativeFragmentPersistenceReady } from "@/domains/production/composition-editor/http/composition-narrative-fragment-rollout.server";

export const runtime = "nodejs";
const handlers = createServerNarrativeFragmentCommandHandlers({ recoveryEnabled: narrativeFragmentPersistenceReady });
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handlers.recover(request, (await context.params).draftId);
}
