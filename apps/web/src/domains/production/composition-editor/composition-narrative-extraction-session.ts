import { narrativeExtractionApplyRequestSchema, narrativeExtractionSummarySchema, narrativeExtractionSelectionKey, narrativeExtractionCommandResultSchema,
  type NarrativeExtractionApplyRequest, type NarrativeExtractionQuery, type NarrativeExtractionSummary } from "./composition-narrative-extraction-contract";
import type { NarrativeExtractionCommandResponse } from "./composition-narrative-extraction-command.client";
import { NarrativeCommandSession } from "./composition-narrative-command-session";

type ConfirmedReceipt = Extract<NarrativeExtractionCommandResponse, { kind: "CONFIRMED" }>["receipt"];
/** Voice policy preserves the existing public API while sharing the command lifecycle. */
export class NarrativeExtractionSession extends NarrativeCommandSession<NarrativeExtractionApplyRequest,
  NarrativeExtractionQuery, NarrativeExtractionSummary, ConfirmedReceipt> {
  constructor() {
    super({ commandSchema: narrativeExtractionApplyRequestSchema, selectionKey: narrativeExtractionSelectionKey,
      validateReview(selection, summary) {
        const parsed = narrativeExtractionSummarySchema.safeParse(summary);
        return parsed.success && parsed.data.documentHash === selection.documentHash ? parsed.data : null;
      },
      createCommand: (selection, summary, commandId) => ({ contract: "NARRATIVE_VOICE_EXTRACTION_APPLY_V1",
        commandId, selection, reviewFingerprint: summary.reviewFingerprint }),
      validateReceipt: receipt => narrativeExtractionCommandResultSchema.safeParse(receipt).success,
    });
  }
}
export type NarrativeExtractionSessionState = NarrativeExtractionSession["state"];
