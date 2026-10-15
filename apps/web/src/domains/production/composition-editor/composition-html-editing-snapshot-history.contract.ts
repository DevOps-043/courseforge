import { z } from "zod";
import { HTML_EDITING_SNAPSHOT_BUNDLE_POLICY } from "./composition-html-editing-snapshot-bundle-policy";

export const HTML_SNAPSHOT_HISTORY_POLICY = Object.freeze({ pageSize: 20, responseBytes: 64 * 1024, timeoutMs: 15_000 });
const scopeSchema = z.object({ actorId: z.string().uuid(), organizationId: z.string().uuid(),
  compositionId: z.string().uuid(), draftId: z.string().uuid() }).strict();
const revisionNumber = z.number().int().min(0).max(2_147_483_647);
export const htmlSnapshotHistoryCursorSchema = scopeSchema.extend({ ceilingRevision: revisionNumber, afterRevision: revisionNumber }).strict()
  .refine(cursor => cursor.afterRevision <= cursor.ceilingRevision);
export const htmlSnapshotHistoryRequestSchema = scopeSchema.extend({ cursor: htmlSnapshotHistoryCursorSchema.nullable() }).strict()
  .refine(request => !request.cursor || (["actorId", "organizationId", "compositionId", "draftId"] as const)
    .every(key => request[key] === request.cursor![key]));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.object({ revisionId: z.string().uuid(), revisionNumber: revisionNumber.refine(number => number > 0),
  snapshot: z.boolean(), draftId: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i).nullable(), documentHash: hash.nullable(),
  bundlePin: z.object({ schemaVersion: z.literal(1), path: z.literal(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath), sha256: hash }).strict().nullable(),
  metadataStatus: z.enum(["HTML_PIN_REQUIRES_BYTE_INSPECTION", "MISSING_OR_INVALID_HTML_METADATA", "NOT_MARKED_AS_SNAPSHOT"]),
}).strict().refine(entry => entry.metadataStatus === "HTML_PIN_REQUIRES_BYTE_INSPECTION"
  ? entry.snapshot && entry.draftId !== null && entry.documentHash !== null && entry.bundlePin !== null
  : entry.metadataStatus === "NOT_MARKED_AS_SNAPSHOT" ? !entry.snapshot : entry.snapshot && (entry.draftId === null || entry.documentHash === null || entry.bundlePin === null));
export const htmlSnapshotHistoryPageSchema = scopeSchema.extend({
  scope: z.literal("AUTHORIZED_HISTORY_METADATA_NOT_CONTENT_OR_EXECUTION_AUTHORITY"),
  ceilingRevision: revisionNumber, entries: z.array(entrySchema).max(HTML_SNAPSHOT_HISTORY_POLICY.pageSize),
  nextCursor: htmlSnapshotHistoryCursorSchema.nullable(),
}).strict().refine(page => page.entries.every((entry, index) => entry.revisionNumber <= page.ceilingRevision
  && (index === 0 || entry.revisionNumber > page.entries[index - 1]!.revisionNumber))
  && new Set(page.entries.map(entry => entry.revisionId)).size === page.entries.length
  && (!page.nextCursor || page.entries.length === HTML_SNAPSHOT_HISTORY_POLICY.pageSize
    && page.nextCursor.ceilingRevision === page.ceilingRevision
    && page.nextCursor.afterRevision === page.entries.at(-1)!.revisionNumber
    && (["actorId", "organizationId", "compositionId", "draftId"] as const).every(key => page[key] === page.nextCursor![key])));
export type HtmlSnapshotHistoryRequest = z.infer<typeof htmlSnapshotHistoryRequestSchema>;
export type HtmlSnapshotHistoryPage = z.infer<typeof htmlSnapshotHistoryPageSchema>;

/** Correlation and page integrity only; never an authorization decision. */
export function matchesHtmlSnapshotHistoryPage(page: HtmlSnapshotHistoryPage, request: HtmlSnapshotHistoryRequest) {
  return (["actorId", "organizationId", "compositionId", "draftId"] as const).every(key => page[key] === request[key])
    && (!request.cursor || page.ceilingRevision === request.cursor.ceilingRevision)
    && page.entries.every(entry => entry.revisionNumber > (request.cursor?.afterRevision ?? 0));
}
