import { z } from "zod";
import { htmlHistoricalPublicationCommandSchema, htmlHistoricalPublicationReceiptSchema,
  type HtmlHistoricalPublicationCommand } from "./composition-html-editing-historical-publication.contract";
import { computeHistoricalHtmlPublicationDigest, matchesHistoricalHtmlPublicationReceipt } from "./composition-html-editing-historical-publication.client";
import type { HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";

const maximumJournalBytes = 8192;
export const htmlHistoricalJournalScopeSchema = htmlHistoricalPublicationCommandSchema.omit({operationId: true, request: true});
export type HtmlHistoricalJournalScope = z.infer<typeof htmlHistoricalJournalScopeSchema>;
const entrySchema = z.object({schemaVersion: z.literal(1), command: htmlHistoricalPublicationCommandSchema,
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  receipt: htmlHistoricalPublicationReceiptSchema.optional(),
}).strict();
export type HtmlHistoricalJournalEntry = z.infer<typeof entrySchema>;
export type HtmlHistoricalJournalState = {status: "EMPTY"} | {status: "UNAVAILABLE"}
  | {status: "PENDING"; entry: HtmlHistoricalJournalEntry};
function key(input: HtmlHistoricalJournalScope) {
  const scope = htmlHistoricalJournalScopeSchema.parse(input);
  return `courseforge:html-historical-publication:v1:${scope.actorId}:${scope.organizationId}:${scope.compositionId}:${scope.draftId}`;
}
export function historicalHtmlJournalStorageKey(scope: HtmlHistoricalJournalScope) {return key(scope);}
function owner(command: HtmlHistoricalPublicationCommand): HtmlHistoricalJournalScope {
  return htmlHistoricalJournalScopeSchema.parse({actorId: command.actorId, organizationId: command.organizationId,
    compositionId: command.compositionId, draftId: command.draftId});
}
function encoded(entry: HtmlHistoricalJournalEntry) {
  const raw = JSON.stringify(entry);
  if (new TextEncoder().encode(raw).byteLength > maximumJournalBytes) throw new Error();
  return raw;
}

/** Metadata only, no source or approval. Call under the existing cooperative
 * draft lock; localStorage is not transactional. Never overwrite/expire/delete
 * uncertain operations. Receipt is history, never native/editor state. */
export async function readHistoricalHtmlJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlHistoricalJournalScope): Promise<HtmlHistoricalJournalState> {
  if (!storage) return {status: "UNAVAILABLE"};
  try {
    const journalKey = key(scope), raw = storage.getItem(journalKey);
    if (raw === null) return {status: "EMPTY"};
    if (new TextEncoder().encode(raw).byteLength > maximumJournalBytes) return {status: "UNAVAILABLE"};
    const entry = entrySchema.parse(JSON.parse(raw));
    if (key(owner(entry.command)) !== journalKey || await computeHistoricalHtmlPublicationDigest(entry.command) !== entry.requestSha256
      || entry.receipt && !await matchesHistoricalHtmlPublicationReceipt(entry.command, entry.requestSha256, entry.receipt)
      || storage.getItem(journalKey) !== raw) return {status: "UNAVAILABLE"};
    return {status: "PENDING", entry};
  } catch {return {status: "UNAVAILABLE"};}
}

export async function beginHistoricalHtmlJournal(storage: HtmlSnapshotLocatorStorage | null,
  commandInput: HtmlHistoricalPublicationCommand, createdAt = Date.now()): Promise<HtmlHistoricalJournalEntry | null> {
  if (!storage) return null;
  try {
    const command = htmlHistoricalPublicationCommandSchema.parse(commandInput), scope = owner(command);
    const entry = entrySchema.parse({schemaVersion: 1, command, requestSha256: await computeHistoricalHtmlPublicationDigest(command), createdAt});
    if ((await readHistoricalHtmlJournal(storage, scope)).status !== "EMPTY") return null;
    const journalKey = key(scope), raw = encoded(entry);
    // No await between final occupancy check and set/readback.
    if (storage.getItem(journalKey) !== null) return null;
    storage.setItem(journalKey, raw);
    return storage.getItem(journalKey) === raw ? entry : null;
  } catch {return null;}
}

export async function recordHistoricalHtmlJournalReceipt(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlHistoricalJournalScope, expectedInput: HtmlHistoricalJournalEntry, receiptInput: unknown): Promise<boolean> {
  if (!storage) return false;
  try {
    const expected = entrySchema.parse(expectedInput), receipt = htmlHistoricalPublicationReceiptSchema.parse(receiptInput);
    const current = await readHistoricalHtmlJournal(storage, scope);
    if (current.status !== "PENDING" || encoded(current.entry) !== encoded(expected)
      || !await matchesHistoricalHtmlPublicationReceipt(expected.command, expected.requestSha256, receipt)) return false;
    const journalKey = key(scope);
    if (storage.getItem(journalKey) !== encoded(expected)) return false;
    const raw = encoded({...expected, receipt}); storage.setItem(journalKey, raw);
    return storage.getItem(journalKey) === raw;
  } catch {return false;}
}

/** Explicit history acknowledgement only, called under the shared lock after a
 * fresh authorized receipt GET. Never infer verification from cached metadata. */
export async function closeVerifiedHistoricalHtmlJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlHistoricalJournalScope, expectedInput: HtmlHistoricalJournalEntry, isCurrent: () => boolean): Promise<boolean> {
  if (!storage) return false;
  try {
    const expected = entrySchema.parse(expectedInput);
    if (!expected.receipt) return false;
    const current = await readHistoricalHtmlJournal(storage, scope);
    if (current.status !== "PENDING" || encoded(current.entry) !== encoded(expected)) return false;
    const journalKey = key(scope);
    if (!isCurrent() || storage.getItem(journalKey) !== encoded(expected)) return false;
    storage.removeItem(journalKey);
    return storage.getItem(journalKey) === null;
  } catch {return false;}
}
