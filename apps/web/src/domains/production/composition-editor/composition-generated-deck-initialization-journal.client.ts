import { z } from "zod";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import { GENERATED_DECK_INITIALIZATION_POLICY, generatedDeckInitializationRequestSchema,
  generatedDeckInitializationReceiptSchema } from "./composition-generated-deck-initialization.contract";

const maximumJournalBytes = GENERATED_DECK_INITIALIZATION_POLICY.maximumReceiptBytes + 4096;
const entrySchema = z.object({ schemaVersion: z.literal(1), scope: htmlSnapshotLocatorScopeSchema,
  request: generatedDeckInitializationRequestSchema, createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  receipt: generatedDeckInitializationReceiptSchema.optional(),
}).strict().refine(entry => !entry.receipt || entry.receipt.operationId === entry.request.operationId
  && entry.receipt.requestSha256 === entry.request.requestSha256 && entry.receipt.expectedDocumentHash === entry.request.expectedDocumentHash
  && entry.receipt.owner.actorId === entry.scope.actorId && entry.receipt.owner.organizationId === entry.scope.organizationId
  && entry.receipt.owner.draftId === entry.scope.draftId);
export type GeneratedDeckInitializationJournalEntry = z.infer<typeof entrySchema>;
export type GeneratedDeckInitializationJournalState = { status: "EMPTY" } | { status: "UNAVAILABLE" }
  | { status: "PENDING"; entry: GeneratedDeckInitializationJournalEntry };
function key(scope: HtmlSnapshotLocatorScope) {
  const owner = htmlSnapshotLocatorScopeSchema.parse(scope);
  return `courseforge:generated-deck-initialization:v1:${owner.actorId}:${owner.organizationId}:${owner.draftId}`;
}
function encode(entry: GeneratedDeckInitializationJournalEntry) {
  const encoded = JSON.stringify(entry);
  if (new TextEncoder().encode(encoded).byteLength > maximumJournalBytes) throw new Error("GENERATED_DECK_TRACKING_OVERSIZED");
  return encoded;
}
/** Metadata only. Storage is not server authority. Transitions require shared
 * draft lock/native reservation; malformed or unknown outcomes never reset. */
export function readGeneratedDeckInitializationJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope): GeneratedDeckInitializationJournalState {
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
export function beginGeneratedDeckInitializationJournal(storage: HtmlSnapshotLocatorStorage | null,
  input: Omit<GeneratedDeckInitializationJournalEntry, "schemaVersion" | "receipt">): boolean {
  if (!storage) return false;
  try {
    if ("schemaVersion" in input || "receipt" in input) return false;
    const entry = entrySchema.parse({ ...input, schemaVersion: 1 });
    if (readGeneratedDeckInitializationJournal(storage, input.scope).status !== "EMPTY") return false;
    const encoded = encode(entry); storage.setItem(key(input.scope), encoded);
    return storage.getItem(key(input.scope)) === encoded;
  } catch { return false; }
}
/** Only an exact validated POST/operation-GET receipt, never inferred from HTML
 * content, an inspector, current readiness or a matching native hash. */
export function recordGeneratedDeckInitializationReceipt(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expected: GeneratedDeckInitializationJournalEntry, receipt: unknown): boolean {
  if (!storage) return false;
  try {
    const parsed = entrySchema.parse(expected), state = readGeneratedDeckInitializationJournal(storage, scope);
    if (state.status !== "PENDING" || JSON.stringify(state.entry) !== JSON.stringify(parsed)) return false;
    const next = entrySchema.parse({ ...parsed, receipt: generatedDeckInitializationReceiptSchema.parse(receipt) });
    if (parsed.receipt && JSON.stringify(parsed.receipt) !== JSON.stringify(next.receipt)) return false;
    const encoded = encode(next); storage.setItem(key(scope), encoded);
    return storage.getItem(key(scope)) === encoded;
  } catch { return false; }
}
/** Coordinator must verify current payload/authority or explicit historical-only
 * confirmation before calling. Unknown intents cannot be forgotten/retried. */
export function closeVerifiedGeneratedDeckInitializationJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expected: GeneratedDeckInitializationJournalEntry): boolean {
  if (!storage) return false;
  try {
    const parsed = entrySchema.parse(expected), state = readGeneratedDeckInitializationJournal(storage, scope);
    if (!parsed.receipt || state.status !== "PENDING" || JSON.stringify(parsed) !== JSON.stringify(state.entry)) return false;
    storage.removeItem(key(scope)); return storage.getItem(key(scope)) === null;
  } catch { return false; }
}
