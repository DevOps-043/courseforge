import { z } from "zod";
import type { HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import { HTML_RECONSTRUCTION_RESOURCE_LINK_POLICY as policy, htmlReconstructionResourceLinkCommandSchema,
  htmlReconstructionResourceLinkReceiptSchema, matchesHtmlReconstructionResourceLinkReceipt,
  type HtmlReconstructionResourceLinkCommand } from "./composition-html-editing-reconstruction-resource-link.contract";
import { computeHtmlReconstructionResourceLinkDigest } from "./composition-html-editing-reconstruction-resource-link.client";

export const htmlReconstructionResourceLinkScopeSchema = htmlReconstructionResourceLinkCommandSchema.omit({operationId: true, request: true});
export type HtmlReconstructionResourceLinkScope = z.infer<typeof htmlReconstructionResourceLinkScopeSchema>;
const entrySchema = z.object({schemaVersion: z.literal(1), command: htmlReconstructionResourceLinkCommandSchema,
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/), receipt: htmlReconstructionResourceLinkReceiptSchema.optional()}).strict();
export type HtmlReconstructionResourceLinkEntry = z.infer<typeof entrySchema>;
export type HtmlReconstructionResourceLinkTracking = {status: "EMPTY" | "UNAVAILABLE"} | {status: "PENDING"; entry: HtmlReconstructionResourceLinkEntry};
function scopeOf(command: HtmlReconstructionResourceLinkCommand): HtmlReconstructionResourceLinkScope {
  return {actorId: command.actorId, organizationId: command.organizationId, compositionId: command.compositionId, draftId: command.draftId};
}
function key(scope: HtmlReconstructionResourceLinkScope) {
  const parsed = htmlReconstructionResourceLinkScopeSchema.parse(scope);
  return `courseforge:html-reconstruction-resource-link:v1:${parsed.actorId}:${parsed.organizationId}:${parsed.compositionId}:${parsed.draftId}`;
}
function encode(entry: HtmlReconstructionResourceLinkEntry) {
  const raw = JSON.stringify(entrySchema.parse(entry));
  if (new TextEncoder().encode(raw).byteLength > policy.journalBytes) throw new Error();
  return raw;
}
/** Private browser metadata under the existing cooperative draft lock. Never
 * overwrite, auto-expire or infer an empty slot from corrupt/unavailable data. */
export async function readHtmlReconstructionResourceLinkJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlReconstructionResourceLinkScope): Promise<HtmlReconstructionResourceLinkTracking> {
  if (!storage) return {status: "UNAVAILABLE"};
  try {
    const journalKey = key(scope), raw = storage.getItem(journalKey); if (raw === null) return {status: "EMPTY"};
    if (new TextEncoder().encode(raw).byteLength > policy.journalBytes) throw new Error();
    const entry = entrySchema.parse(JSON.parse(raw));
    if (key(scopeOf(entry.command)) !== journalKey || entry.requestSha256 !== await computeHtmlReconstructionResourceLinkDigest(entry.command)
      || entry.receipt && !matchesHtmlReconstructionResourceLinkReceipt(entry.receipt, entry.command, entry.requestSha256)
      || storage.getItem(journalKey) !== raw) throw new Error();
    return {status: "PENDING", entry};
  } catch {return {status: "UNAVAILABLE"};}
}
export async function beginHtmlReconstructionResourceLinkJournal(storage: HtmlSnapshotLocatorStorage | null,
  input: HtmlReconstructionResourceLinkCommand) {
  if (!storage) return null;
  try {
    const command = htmlReconstructionResourceLinkCommandSchema.parse(input), scope = scopeOf(command);
    const entry = entrySchema.parse({schemaVersion: 1, command, requestSha256: await computeHtmlReconstructionResourceLinkDigest(command)});
    if ((await readHtmlReconstructionResourceLinkJournal(storage, scope)).status !== "EMPTY") return null;
    const journalKey = key(scope), raw = encode(entry);
    if (storage.getItem(journalKey) !== null) return null;
    storage.setItem(journalKey, raw); return storage.getItem(journalKey) === raw ? entry : null;
  } catch {return null;}
}
/** Write a validated direct/authorized-read receipt, preserving exact operation.
 * Closing requires a separate fresh receipt GET at the coordinator boundary. */
export async function recordHtmlReconstructionResourceLinkReceipt(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlReconstructionResourceLinkScope, expected: HtmlReconstructionResourceLinkEntry, receiptInput: unknown) {
  if (!storage) return null;
  try {
    const receipt = htmlReconstructionResourceLinkReceiptSchema.parse(receiptInput), current = await readHtmlReconstructionResourceLinkJournal(storage, scope);
    if (current.status !== "PENDING" || encode(current.entry) !== encode(expected)
      || !matchesHtmlReconstructionResourceLinkReceipt(receipt, expected.command, expected.requestSha256)
      || expected.receipt && JSON.stringify(expected.receipt) !== JSON.stringify(receipt)) return null;
    const journalKey = key(scope), entry = {...expected, receipt}, raw = encode(entry);
    if (storage.getItem(journalKey) !== encode(expected)) return null;
    storage.setItem(journalKey, raw); return storage.getItem(journalKey) === raw ? entry : null;
  } catch {return null;}
}
export async function closeVerifiedHtmlReconstructionResourceLinkJournal(storage: HtmlSnapshotLocatorStorage | null,
  scope: HtmlReconstructionResourceLinkScope, expected: HtmlReconstructionResourceLinkEntry, isCurrent: () => boolean) {
  if (!storage || !expected.receipt) return false;
  try {
    const current = await readHtmlReconstructionResourceLinkJournal(storage, scope), journalKey = key(scope);
    if (current.status !== "PENDING" || encode(current.entry) !== encode(expected) || !isCurrent() || storage.getItem(journalKey) !== encode(expected)) return false;
    storage.removeItem(journalKey); return storage.getItem(journalKey) === null;
  } catch {return false;}
}
