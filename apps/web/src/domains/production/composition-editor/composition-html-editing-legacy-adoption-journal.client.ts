import { z } from "zod";
import { HTML_LEGACY_ADOPTION_POLICY as policy, htmlLegacyAdoptionCommandSchema, htmlLegacyAdoptionReceiptSchema } from "./composition-html-editing-legacy-adoption.contract";
import { computeHtmlLegacyAdoptionRequestSha256InBrowser, matchesHtmlLegacyAdoptionReceipt } from "./composition-html-editing-legacy-adoption-operation.client";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";

const entrySchema = z.object({ schemaVersion: z.literal(1), command: htmlLegacyAdoptionCommandSchema,
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  receipt: htmlLegacyAdoptionReceiptSchema.optional(),
}).strict().refine(entry => !entry.receipt || entry.receipt.operationId === entry.command.operationId
  && entry.receipt.owner.actorId === entry.command.actorId && entry.receipt.owner.organizationId === entry.command.organizationId
  && entry.receipt.owner.draftId === entry.command.documentId && entry.receipt.clipId === entry.command.clipId
  && entry.receipt.requestSha256 === entry.requestSha256 && JSON.stringify(entry.receipt.request) === JSON.stringify(entry.command.request));
export type HtmlLegacyAdoptionJournalEntry = z.infer<typeof entrySchema>;
export type HtmlLegacyAdoptionJournalState = { status: "EMPTY" } | { status: "UNAVAILABLE" }
  | { status: "PENDING"; entry: HtmlLegacyAdoptionJournalEntry };
function key(input: HtmlSnapshotLocatorScope) {
  const scope = htmlSnapshotLocatorScopeSchema.parse(input);
  return `courseforge:html-legacy-adoption:v1:${scope.actorId}:${scope.organizationId}:${scope.draftId}`;
}
function owner(entry: HtmlLegacyAdoptionJournalEntry): HtmlSnapshotLocatorScope {
  return { actorId: entry.command.actorId, organizationId: entry.command.organizationId, draftId: entry.command.documentId };
}
function encoded(entry: HtmlLegacyAdoptionJournalEntry) {
  const value = JSON.stringify(entry);
  if (new TextEncoder().encode(value).byteLength > policy.journalBytes) throw new Error();
  return value;
}
/** Metadata only, no source/approval/grants. Must mutate under shared draft lock
 * and native reservation. No overwrite, automatic expiry or uncertain deletion. */
export function readHtmlLegacyAdoptionJournal(storage: HtmlSnapshotLocatorStorage | null, scope: HtmlSnapshotLocatorScope): HtmlLegacyAdoptionJournalState {
  if (!storage) return { status: "UNAVAILABLE" };
  try {
    const raw = storage.getItem(key(scope));
    if (raw === null) return { status: "EMPTY" };
    if (new TextEncoder().encode(raw).byteLength > policy.journalBytes) return { status: "UNAVAILABLE" };
    const entry = entrySchema.parse(JSON.parse(raw)), expected = htmlSnapshotLocatorScopeSchema.parse(scope);
    if (JSON.stringify(owner(entry)) !== JSON.stringify(expected)) return { status: "UNAVAILABLE" };
    return { status: "PENDING", entry };
  } catch { return { status: "UNAVAILABLE" }; }
}
export async function beginHtmlLegacyAdoptionJournal(storage: HtmlSnapshotLocatorStorage | null,
  input: Omit<HtmlLegacyAdoptionJournalEntry, "schemaVersion" | "receipt">): Promise<boolean> {
  if (!storage) return false;
  try {
    if ("schemaVersion" in input || "receipt" in input) return false;
    const entry = entrySchema.parse({ ...input, schemaVersion: 1 });
    if (await computeHtmlLegacyAdoptionRequestSha256InBrowser(entry.command) !== entry.requestSha256) return false;
    const scope = owner(entry);
    if (readHtmlLegacyAdoptionJournal(storage, scope).status !== "EMPTY") return false;
    const raw = encoded(entry); storage.setItem(key(scope), raw);
    return storage.getItem(key(scope)) === raw;
  } catch { return false; }
}
export async function recordHtmlLegacyAdoptionJournalReceipt(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expectedInput: HtmlLegacyAdoptionJournalEntry, receiptInput: unknown): Promise<boolean> {
  if (!storage) return false;
  try {
    const expected = entrySchema.parse(expectedInput), receipt = htmlLegacyAdoptionReceiptSchema.parse(receiptInput);
    if (!await matchesHtmlLegacyAdoptionReceipt(expected.command, expected.requestSha256, receipt)) return false;
    const state = readHtmlLegacyAdoptionJournal(storage, scope);
    if (state.status !== "PENDING" || JSON.stringify(state.entry) !== JSON.stringify(expected)
      || (expected.receipt && JSON.stringify(expected.receipt) !== JSON.stringify(receipt))) return false;
    const raw = encoded(entrySchema.parse({ ...expected, receipt })); storage.setItem(key(scope), raw);
    return storage.getItem(key(scope)) === raw;
  } catch { return false; }
}
/** Caller first rereads receipt on server and verifies fresh authorized native /
 * inspector (or explicitly acknowledges historical-only state). Stored ACK alone
 * is NOT sufficient. Exact comparison prevents clearing a replaced journal. */
export function closeVerifiedHtmlLegacyAdoptionJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlSnapshotLocatorScope, expectedInput: HtmlLegacyAdoptionJournalEntry): boolean {
  if (!storage) return false;
  try {
    const expected = entrySchema.parse(expectedInput), state = readHtmlLegacyAdoptionJournal(storage, scope);
    if (!expected.receipt || state.status !== "PENDING" || JSON.stringify(state.entry) !== JSON.stringify(expected)) return false;
    storage.removeItem(key(scope)); return storage.getItem(key(scope)) === null;
  } catch { return false; }
}
