import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import { htmlEditingInitializationRequestSchema, htmlEditingInitializationAcknowledgmentSchema } from "./composition-html-editing-initialization-http.contract";
import { htmlEditingInitializationOperationReceiptSchema } from "./composition-html-editing-initialization-operation.contract";

const maximumJournalBytes = 4096;
const entrySchema = z.object({ schemaVersion: z.literal(1), scope: htmlSnapshotLocatorScopeSchema, operationId: z.string().uuid(),
  clipId: htmlEditingBindingSchema.shape.clipId, createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  request: htmlEditingInitializationRequestSchema, requestSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  acknowledgment: htmlEditingInitializationAcknowledgmentSchema.optional() }).strict()
  .refine(entry => !entry.acknowledgment || entry.acknowledgment.compositionDocumentHash === entry.request.expectedDocumentHash);
export type HtmlEditingInitializationJournalEntry = z.infer<typeof entrySchema>;
export type HtmlEditingInitializationJournalState = { status: "EMPTY" } | { status: "UNAVAILABLE" }
  | { status: "PENDING"; entry: HtmlEditingInitializationJournalEntry };
function key(scopeInput: HtmlSnapshotLocatorScope) {
  const scope = htmlSnapshotLocatorScopeSchema.parse(scopeInput);
  return `courseforge:html-initialization:v1:${scope.actorId}:${scope.organizationId}:${scope.draftId}`;
}
function encodedEntry(entry: HtmlEditingInitializationJournalEntry) {
  const encoded = JSON.stringify(entry);
  if (new TextEncoder().encode(encoded).byteLength > maximumJournalBytes) throw new Error("INITIALIZATION_TRACKING_OVERSIZE");
  return encoded;
}
/** Metadata only; localStorage is neither authorization nor CAS. Every transition
 * must run under the shared draft lock/native reservation. No unknown deletion. */
export function readHtmlEditingInitializationJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope): HtmlEditingInitializationJournalState {
  if (!storage) return { status: "UNAVAILABLE" };
  try {
    const raw = storage.getItem(key(scope));
    if (raw === null) return { status: "EMPTY" };
    if (new TextEncoder().encode(raw).byteLength > maximumJournalBytes) return { status: "UNAVAILABLE" };
    const entry = entrySchema.parse(JSON.parse(raw));
    if (entry.scope.actorId !== scope.actorId || entry.scope.organizationId !== scope.organizationId || entry.scope.draftId !== scope.draftId)
      return { status: "UNAVAILABLE" };
    return { status: "PENDING", entry };
  } catch { return { status: "UNAVAILABLE" }; }
}
export function beginHtmlEditingInitializationJournal(storage: HtmlSnapshotLocatorStorage | null,
  input: Omit<HtmlEditingInitializationJournalEntry, "schemaVersion" | "acknowledgment">): boolean {
  if (!storage) return false;
  try {
    if ("schemaVersion" in input || "acknowledgment" in input) return false;
    const entry = entrySchema.parse({ ...input, schemaVersion: 1 });
    if (readHtmlEditingInitializationJournal(storage, entry.scope).status !== "EMPTY") return false;
    const encoded = encodedEntry(entry); storage.setItem(key(entry.scope), encoded);
    return storage.getItem(key(entry.scope)) === encoded;
  } catch { return false; }
}
/** Only directly validated initialization POST ACK, never latest/inspector GET.
 * Keeping ACK does not mean native refresh/verification completed. */
export function acknowledgeHtmlEditingInitializationJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expectedEntry: HtmlEditingInitializationJournalEntry, acknowledgment: unknown): boolean {
  if (!storage) return false;
  try {
    const expected = entrySchema.parse(expectedEntry), state = readHtmlEditingInitializationJournal(storage, scope);
    if (state.status !== "PENDING" || JSON.stringify(state.entry) !== JSON.stringify(expected)) return false;
    const next = entrySchema.parse({ ...expected, acknowledgment: htmlEditingInitializationAcknowledgmentSchema.parse(acknowledgment) });
    if (expected.acknowledgment && JSON.stringify(expected.acknowledgment) !== JSON.stringify(next.acknowledgment)) return false;
    const encoded = encodedEntry(next); storage.setItem(key(scope), encoded);
    return storage.getItem(key(scope)) === encoded;
  } catch { return false; }
}
/** Receipt was verified by the bounded operation client. Compare exact persisted
 * identity and request again before recording its historical acknowledgment.
 * Legacy intents have no server operation identity and cannot use this path. */
export function recordHtmlEditingInitializationJournalReceipt(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expectedEntry: HtmlEditingInitializationJournalEntry, receiptInput: unknown): boolean {
  try {
    const expected = entrySchema.parse(expectedEntry), receipt = htmlEditingInitializationOperationReceiptSchema.parse(receiptInput);
    if (!expected.requestSha256 || receipt.owner.actorId !== scope.actorId || receipt.owner.organizationId !== scope.organizationId
      || receipt.owner.draftId !== scope.draftId || receipt.clipId !== expected.clipId || receipt.operationId !== expected.operationId
      || receipt.requestSha256 !== expected.requestSha256 || JSON.stringify(receipt.request) !== JSON.stringify(expected.request)) return false;
    return acknowledgeHtmlEditingInitializationJournal(storage, scope, expected, receipt.acknowledgment);
  } catch { return false; }
}
/** Caller verifies authorized initial inspector/source/template plus loaded native
 * document before closure. This does not reconstruct editorial undo or activate it. */
export function closeVerifiedHtmlEditingInitializationJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expectedEntry: HtmlEditingInitializationJournalEntry): boolean {
  if (!storage) return false;
  try {
    const expected = entrySchema.parse(expectedEntry), state = readHtmlEditingInitializationJournal(storage, scope);
    if (!expected.acknowledgment || state.status !== "PENDING" || JSON.stringify(state.entry) !== JSON.stringify(expected)) return false;
    storage.removeItem(key(scope)); return storage.getItem(key(scope)) === null;
  } catch { return false; }
}
