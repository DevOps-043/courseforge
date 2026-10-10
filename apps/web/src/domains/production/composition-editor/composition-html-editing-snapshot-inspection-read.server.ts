import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { canonicalHtmlEditingJson } from "./html-editing/html-editing-canonical-json.server";
import { inspectHtmlSnapshotArchive } from "./composition-html-editing-snapshot-inspection.server";
import { HTML_EDITING_SNAPSHOT_BUNDLE_POLICY } from "./composition-html-editing-snapshot-bundle-policy";
import { HTML_SNAPSHOT_ZIP_POLICY } from "./composition-html-editing-snapshot-zip.server";
import { streamPinnedHtmlStorageObject } from "./composition-html-pinned-storage-reader.server";
import { HTML_SNAPSHOT_INSPECTION_POLICY, htmlSnapshotInspectionReadRequestSchema,
  type HtmlSnapshotInspectionReadRequest } from "./composition-html-editing-snapshot-inspection.contract";

export const HTML_SNAPSHOT_INSPECTION_READ_POLICY = Object.freeze({ timeoutMs: HTML_SNAPSHOT_INSPECTION_POLICY.timeoutMs,
  identityBytes: 4096, maximumConcurrentReads: 1 });
let activeReads = 0;
const authorizedArchiveSchema = htmlSnapshotInspectionReadRequestSchema.extend({
  scope: z.literal("AUTHORIZED_HISTORICAL_HTML_ARCHIVE_READ_ONLY"), documentId: z.string().uuid(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), projectHash: z.string().regex(/^[a-f0-9]{64}$/),
  archiveBytes: z.number().int().positive().max(HTML_SNAPSHOT_ZIP_POLICY.maximumArchiveBytes),
  storageBucket: z.literal("production-assets"), storagePath: z.string().max(1024),
  bundlePin: z.object({ schemaVersion: z.literal(1), path: z.literal(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict().refine(identity => identity.storagePath ===
  `composition-snapshots/${identity.organizationId}/${identity.compositionId}/${identity.projectHash}.zip`);
export {authorizedArchiveSchema as htmlSnapshotArchiveIdentitySchema};

type ArchiveReadInput = {
  request: HtmlSnapshotInspectionReadRequest; supabase: SupabaseClient; storageOrigin: string;
  signal?: AbortSignal; fetchResource?: typeof fetch;
};
type InspectedArchive = Awaited<ReturnType<typeof inspectHtmlSnapshotArchive>>;
type AuthorizedArchive = z.infer<typeof authorizedArchiveSchema>;

/** Internal read-only composition. consume is trusted server code, never an
 * HTTP callback. Private bundle bytes may only feed reviewed preparation, not
 * execution or writes. The original identity is reauthorized AFTER consume. */
export async function withAuthorizedHtmlSnapshotArchive<Result>(input: ArchiveReadInput,
  consume: (archive: { request: HtmlSnapshotInspectionReadRequest; identity: AuthorizedArchive;
    inspected: InspectedArchive }, signal: AbortSignal) => Promise<Result>): Promise<Result> {
  // No waiting queue or retained archive for competing reads in this process.
  if (activeReads >= HTML_SNAPSHOT_INSPECTION_READ_POLICY.maximumConcurrentReads) throw new Error("HTML_SNAPSHOT_INSPECTION_READ_UNAVAILABLE");
  activeReads++;
  try {
    const request = Object.freeze(htmlSnapshotInspectionReadRequestSchema.parse(input.request));
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_SNAPSHOT_INSPECTION_READ_POLICY.timeoutMs)])
      : AbortSignal.timeout(HTML_SNAPSHOT_INSPECTION_READ_POLICY.timeoutMs);
    const authorize = async () => {
      signal.throwIfAborted();
      const response = await input.supabase.rpc("read_html_editing_snapshot_archive", {
        p_org: request.organizationId, p_actor: request.actorId, p_composition: request.compositionId,
        p_draft: request.draftId, p_revision: request.revisionId,
      }).abortSignal(signal);
      signal.throwIfAborted();
      if (response.error || Buffer.byteLength(JSON.stringify(response.data) ?? "", "utf8") > HTML_SNAPSHOT_INSPECTION_READ_POLICY.identityBytes) throw new Error();
      const decoded = authorizedArchiveSchema.parse(response.data);
      const identity = Object.freeze({ ...decoded, bundlePin: Object.freeze(decoded.bundlePin) });
      if ((Object.keys(request) as Array<keyof typeof request>).some(key => identity[key] !== request[key])) throw new Error();
      return identity;
    };
    const identity = await authorize(), archiveBytes = Buffer.alloc(identity.archiveBytes);
    let offset = 0;
    await streamPinnedHtmlStorageObject({ supabase: input.supabase, storageOrigin: input.storageOrigin,
      fetchResource: input.fetchResource, signal,
      identity: { storageBucket: identity.storageBucket, storagePath: identity.storagePath,
        fileSizeBytes: identity.archiveBytes, checksum: identity.projectHash, mimeType: "application/zip" },
      writeChunk: async chunk => { archiveBytes.set(chunk, offset); offset += chunk.byteLength; },
    });
    const inspected = await inspectHtmlSnapshotArchive({ archiveBytes, signal, identity: {
      projectHash: identity.projectHash, archiveBytes: identity.archiveBytes, organizationId: identity.organizationId,
      documentId: identity.documentId, documentHash: identity.documentHash,
      bundlePin: { path: identity.bundlePin.path, sha256: identity.bundlePin.sha256 },
    } });
    const result = await consume({ request, identity, inspected }, signal);
    if (canonicalHtmlEditingJson(identity) !== canonicalHtmlEditingJson(await authorize())) throw new Error();
    signal.throwIfAborted(); return result;
  } catch {
    input.signal?.throwIfAborted(); throw new Error("HTML_SNAPSHOT_INSPECTION_READ_UNAVAILABLE");
  } finally {
    activeReads--;
  }
}

/** Host supplies session-derived actor/org. Two service-only reads authorize
 * before signing AND after inspection; revision metadata must be unchanged.
 * Nothing is compiled, extracted, written, restored, retried or activated. */
export async function readAuthorizedHtmlSnapshotInspection(input: ArchiveReadInput) {
  return withAuthorizedHtmlSnapshotArchive(input, async ({ request, identity, inspected }) => {
    // Do not forward the private source, Storage identity or signed URL to HTTP.
    return { ...request, scope: "AUTHORIZED_ARCHIVE_DIAGNOSTIC_NOT_EXECUTION_OR_PUBLICATION" as const,
      documentId: identity.documentId, documentHash: identity.documentHash, projectHash: inspected.projectHash,
      bundleSha256: inspected.bundleSha256, diagnostic: inspected.diagnostic };
  });
}
