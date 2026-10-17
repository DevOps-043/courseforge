import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlEditingMutationAcknowledgmentSchema, htmlEditingRevisionLocatorSchema } from "./composition-html-editing-mutation.contract";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import { htmlEditingOperationReceiptSchema } from "./composition-html-editing-operation.contract";

const maximumJournalBytes = 4096;
const journalSchema = z.object({
  schemaVersion: z.literal(1), scope: htmlSnapshotLocatorScopeSchema,
  operationId: z.string().uuid(), clipId: htmlEditingBindingSchema.shape.clipId,
  createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  expected: htmlEditingRevisionLocatorSchema,
  expectedCompositionDocumentHash: z.string().regex(/^[a-f0-9]{64}$/),
  acknowledgment: htmlEditingMutationAcknowledgmentSchema.optional(),
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  receipt: htmlEditingOperationReceiptSchema.optional(),
}).strict().superRefine((entry, context) => {
  if (entry.acknowledgment && (entry.acknowledgment.previous.version !== entry.expected.version
    || entry.acknowledgment.previous.sha256 !== entry.expected.sha256)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Journal acknowledgment mismatch" });
  }
  if (entry.receipt ? !entry.requestSha256 || entry.receipt.requestSha256 !== entry.requestSha256
    || entry.receipt.operationId !== entry.operationId || entry.receipt.clipId !== entry.clipId
    || entry.receipt.owner.actorId !== entry.scope.actorId || entry.receipt.owner.organizationId !== entry.scope.organizationId
    || entry.receipt.owner.draftId !== entry.scope.draftId || JSON.stringify(entry.receipt.acknowledgment) !== JSON.stringify(entry.acknowledgment)
    : entry.requestSha256 && entry.acknowledgment) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Journal receipt mismatch" });
  }
});
export type HtmlEditingJournalEntry = z.infer<typeof journalSchema>;
export type HtmlEditingJournalState = { status: "EMPTY" } | { status: "UNAVAILABLE" }
  | { status: "PENDING"; entry: HtmlEditingJournalEntry };

function storageKey(scope: HtmlSnapshotLocatorScope): string {
  const valid = htmlSnapshotLocatorScopeSchema.parse(scope);
  return `courseforge:html-editorial:v1:${valid.actorId}:${valid.organizationId}:${valid.draftId}`;
}

/** Metadata only. A local operation ID is not a server ledger or proof of causality.
 * Call all mutations inside a shared cooperative lock; localStorage is not CAS. */
export function readHtmlEditingJournal(storage: HtmlSnapshotLocatorStorage | null, scope: HtmlSnapshotLocatorScope): HtmlEditingJournalState {
  if (!storage) return { status: "UNAVAILABLE" };
  try {
    const encoded = storage.getItem(storageKey(scope));
    if (encoded === null) return { status: "EMPTY" };
    if (new TextEncoder().encode(encoded).byteLength > maximumJournalBytes) return { status: "UNAVAILABLE" };
    const entry = journalSchema.parse(JSON.parse(encoded));
    if (entry.scope.actorId !== scope.actorId || entry.scope.organizationId !== scope.organizationId
      || entry.scope.draftId !== scope.draftId) return { status: "UNAVAILABLE" };
    return { status: "PENDING", entry };
  } catch { return { status: "UNAVAILABLE" }; }
}

/** Persist and verify before dispatch. Never overwrite even an unreadable slot. */
export function beginHtmlEditingJournal(storage: HtmlSnapshotLocatorStorage | null, input: Omit<HtmlEditingJournalEntry, "schemaVersion" | "acknowledgment" | "receipt">): boolean {
  if (!storage) return false;
  try {
    if ("acknowledgment" in input || "schemaVersion" in input || "receipt" in input) return false;
    const entry = journalSchema.parse({ ...input, schemaVersion: 1 });
    if (readHtmlEditingJournal(storage, entry.scope).status !== "EMPTY") return false;
    const encoded = JSON.stringify(entry);
    storage.setItem(storageKey(entry.scope), encoded);
    return storage.getItem(storageKey(entry.scope)) === encoded;
  } catch { return false; }
}

/** Only a directly validated POST acknowledgment can be recorded, never a GET. */
export function acknowledgeHtmlEditingJournal(storage: HtmlSnapshotLocatorStorage | null, scope: HtmlSnapshotLocatorScope,
  operationId: string, acknowledgment: unknown): boolean {
  if (!storage) return false;
  try {
    const state = readHtmlEditingJournal(storage, scope);
    if (state.status !== "PENDING" || state.entry.operationId !== operationId || state.entry.requestSha256) return false;
    const entry = journalSchema.parse({ ...state.entry, acknowledgment: htmlEditingMutationAcknowledgmentSchema.parse(acknowledgment) });
    if (state.entry.acknowledgment && JSON.stringify(state.entry.acknowledgment) !== JSON.stringify(entry.acknowledgment)) return false;
    const encoded = JSON.stringify(entry);
    storage.setItem(storageKey(scope), encoded);
    return storage.getItem(storageKey(scope)) === encoded;
  } catch { return false; }
}

/** Caller supplies only a validated POST receipt or explicit authorized receipt
 * GET, never an inspector/latest GET. Recording evidence does not close tracking. */
export function recordHtmlEditingJournalReceipt(storage: HtmlSnapshotLocatorStorage | null, scope: HtmlSnapshotLocatorScope,
  operationId: string, receiptInput: unknown): boolean {
  if (!storage) return false;
  try {
    const state = readHtmlEditingJournal(storage, scope), receipt = htmlEditingOperationReceiptSchema.parse(receiptInput);
    if (state.status !== "PENDING" || state.entry.operationId !== operationId || !state.entry.requestSha256) return false;
    const entry = journalSchema.parse({ ...state.entry, receipt, acknowledgment: receipt.acknowledgment });
    if (state.entry.receipt && JSON.stringify(state.entry.receipt) !== JSON.stringify(receipt)) return false;
    const encoded = JSON.stringify(entry);
    if (new TextEncoder().encode(encoded).byteLength > maximumJournalBytes) return false;
    storage.setItem(storageKey(scope), encoded);
    return storage.getItem(storageKey(scope)) === encoded;
  } catch { return false; }
}

/** Caller must explicitly complete authorized refresh and native rebase first.
 * Unknown writes cannot be cleared by finding a matching revision in a GET. */
export function closeRebasedHtmlEditingJournal(storage: HtmlSnapshotLocatorStorage | null, scope: HtmlSnapshotLocatorScope,
  operationId: string, adoptedRevision: unknown): boolean {
  if (!storage) return false;
  try {
    const state = readHtmlEditingJournal(storage, scope);
    const revision = htmlEditingRevisionLocatorSchema.parse(adoptedRevision);
    if (state.status !== "PENDING" || state.entry.operationId !== operationId || !state.entry.acknowledgment
      || state.entry.acknowledgment.next.version !== revision.version
      || state.entry.acknowledgment.next.sha256 !== revision.sha256) return false;
    storage.removeItem(storageKey(scope));
    return storage.getItem(storageKey(scope)) === null;
  } catch { return false; }
}

/** Historical closure only: caller must freshly authorize the durable receipt and
 * verify the already loaded native document under the shared lock/reservation.
 * Does not assert that ACK.next is current or was adopted. Legacy ACK is insufficient. */
export function closeHistoricallyConfirmedHtmlEditingJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expectedEntry: HtmlEditingJournalEntry): boolean {
  if (!storage) return false;
  try {
    const expected = journalSchema.parse(expectedEntry), state = readHtmlEditingJournal(storage, scope);
    if (!expected.receipt || state.status !== "PENDING"
      || JSON.stringify(state.entry) !== JSON.stringify(expected)) return false;
    storage.removeItem(storageKey(scope));
    return storage.getItem(storageKey(scope)) === null;
  } catch { return false; }
}
