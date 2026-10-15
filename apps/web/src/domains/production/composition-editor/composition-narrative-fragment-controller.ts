import { NarrativeCommandController, type NarrativeExtractionExclusiveLock } from "./composition-narrative-command-controller";
import { NarrativeFragmentSession, type NarrativeFragmentSessionState } from "./composition-narrative-fragment-session";
import { narrativeFragmentApplyRequestSchema, type NarrativeFragmentApplyRequest } from "./composition-narrative-fragment-command-contract";
import type { NarrativeFragmentQuery, NarrativeFragmentSummary } from "./composition-narrative-fragment-contract";
import { requestNarrativeFragmentCommand } from "./composition-narrative-fragment-command.client";
import type { NarrativeExtractionPendingScope, NarrativeExtractionPendingStorage } from "./composition-narrative-extraction-pending";

type ConfirmedReceipt = Extract<NarrativeFragmentSessionState, { phase: "RELOAD_REQUIRED" }>["receipt"];
type Dependencies = { storage: NarrativeExtractionPendingStorage; scope: NarrativeExtractionPendingScope;
  exclusiveLock: NarrativeExtractionExclusiveLock; fetcher?: typeof fetch; onState: (state: NarrativeFragmentSessionState) => void;
  /** Reload must verify the entire extracted batch, not just the voice anchor. */
  reloadDocument: (newClipIds: string[], anchorClipId: string, documentHash: string) => Promise<boolean> };

/** Same journal key, browser lock and lifecycle as voice; no independent competing queue. */
export class NarrativeFragmentController extends NarrativeCommandController<NarrativeFragmentApplyRequest,
  NarrativeFragmentQuery, NarrativeFragmentSummary, ConfirmedReceipt> {
  constructor(dependencies: Dependencies) {
    super({ ...dependencies, session: new NarrativeFragmentSession(), commandSchema: narrativeFragmentApplyRequestSchema,
      dispatch: requestNarrativeFragmentCommand,
      reloadDocument: receipt => dependencies.reloadDocument(receipt.newClipIds, receipt.anchorClipId, receipt.documentHash) });
  }
}
