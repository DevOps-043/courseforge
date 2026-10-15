import { NarrativeCommandSession } from "./composition-narrative-command-session";
import { narrativeFragmentApplyRequestSchema, narrativeFragmentCommandResultSchema,
  type NarrativeFragmentApplyRequest } from "./composition-narrative-fragment-command-contract";
import { narrativeFragmentSelectionKey, narrativeFragmentSummarySchema,
  type NarrativeFragmentQuery, type NarrativeFragmentSummary } from "./composition-narrative-fragment-contract";
import type { NarrativeFragmentCommandResponse } from "./composition-narrative-fragment-command.client";

type ConfirmedReceipt = Extract<NarrativeFragmentCommandResponse, { kind: "CONFIRMED" }>["receipt"];
export class NarrativeFragmentSession extends NarrativeCommandSession<NarrativeFragmentApplyRequest,
  NarrativeFragmentQuery, NarrativeFragmentSummary, ConfirmedReceipt> {
  constructor() {
    super({ commandSchema: narrativeFragmentApplyRequestSchema, selectionKey: narrativeFragmentSelectionKey,
      validateReview(query, summary) {
        const parsed = narrativeFragmentSummarySchema.safeParse(summary);
        return parsed.success && parsed.data.documentHash === query.selection.documentHash
          && parsed.data.trackCount === query.selectedTrackIds.length ? parsed.data : null;
      },
      createCommand: (query, summary, commandId) => ({ contract: "NARRATIVE_FRAGMENT_APPLY_V1",
        commandId, query, reviewFingerprint: summary.reviewFingerprint }),
      validateReceipt: receipt => narrativeFragmentCommandResultSchema.safeParse(receipt).success,
    });
  }
}
export type NarrativeFragmentSessionState = NarrativeFragmentSession["state"];
