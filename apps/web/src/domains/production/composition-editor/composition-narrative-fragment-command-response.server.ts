import { narrativeFragmentReceiptSchema, narrativeFragmentCommandResultSchema } from "./composition-narrative-fragment-command-contract";

/** Project historical DB receipt, never current document, operations or internal intent fingerprint. */
export function projectNarrativeFragmentCommandResult(receipt: unknown, status: "COMMITTED" | "REPLAYED" | "CONFIRMED") {
  const parsed = narrativeFragmentReceiptSchema.parse(receipt);
  return narrativeFragmentCommandResultSchema.parse({ contract: "NARRATIVE_FRAGMENT_COMMAND_RESULT_V1", status,
    commandId: parsed.commandId, documentHash: parsed.documentHash, version: parsed.version, anchorClipId: parsed.anchorClipId,
    newClipIds: [...parsed.newClipIds], scope: "DATABASE_COMMIT_ONLY", reloadDocumentRequired: true,
    automaticRetryAllowed: false, recoveryRequired: false });
}
