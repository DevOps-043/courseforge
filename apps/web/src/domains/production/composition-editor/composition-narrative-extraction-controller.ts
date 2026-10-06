import { NarrativeExtractionSession, type NarrativeExtractionSessionState } from "./composition-narrative-extraction-session";
import { requestNarrativeExtractionCommand } from "./composition-narrative-extraction-command.client";
import { narrativeExtractionApplyRequestSchema, type NarrativeExtractionApplyRequest,
  type NarrativeExtractionQuery, type NarrativeExtractionSummary } from "./composition-narrative-extraction-contract";
import type { NarrativeExtractionCommandResponse } from "./composition-narrative-extraction-command.client";
import { NarrativeCommandController, type NarrativeExtractionExclusiveLock } from "./composition-narrative-command-controller";
import type { NarrativeExtractionPendingScope, NarrativeExtractionPendingStorage } from "./composition-narrative-extraction-pending";
export type { NarrativeExtractionExclusiveLock } from "./composition-narrative-command-controller";

type Dependencies = { storage: NarrativeExtractionPendingStorage; scope: NarrativeExtractionPendingScope;
  exclusiveLock: NarrativeExtractionExclusiveLock; fetcher?: typeof fetch; onState: (state: NarrativeExtractionSessionState) => void;
  reloadDocument: (newClipId: string, documentHash: string) => Promise<boolean> };
type ConfirmedReceipt = Extract<NarrativeExtractionCommandResponse, { kind: "CONFIRMED" }>["receipt"];
export class NarrativeExtractionController extends NarrativeCommandController<NarrativeExtractionApplyRequest,
  NarrativeExtractionQuery, NarrativeExtractionSummary, ConfirmedReceipt> {
  constructor(dependencies: Dependencies) {
    super({ ...dependencies, session: new NarrativeExtractionSession(), commandSchema: narrativeExtractionApplyRequestSchema,
      dispatch: requestNarrativeExtractionCommand,
      reloadDocument: receipt => dependencies.reloadDocument(receipt.newClipId, receipt.documentHash) });
  }
}
