import { createHash } from "node:crypto";
import { z } from "zod";
import { diagnoseCompositionHtmlEditingSnapshotCompatibility } from "./composition-html-editing-snapshot-bundle.server";
import { HTML_EDITING_SNAPSHOT_BUNDLE_POLICY } from "./composition-html-editing-snapshot-bundle-policy";
import { HTML_SNAPSHOT_ZIP_POLICY, readHtmlSnapshotZipMember } from "./composition-html-editing-snapshot-zip.server";

const identitySchema = z.object({
  projectHash: z.string().regex(/^[a-f0-9]{64}$/),
  archiveBytes: z.number().int().positive().max(HTML_SNAPSHOT_ZIP_POLICY.maximumArchiveBytes),
  organizationId: z.string().uuid(), documentId: z.string().uuid(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  bundlePin: z.object({ path: z.literal(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
}).strict();
export type HtmlSnapshotInspectionIdentity = z.infer<typeof identitySchema>;

/** Identity must come from an independently authorized revision lookup. This
 * content inspector does NOT authenticate, refresh grants, compile or publish.
 * Bundle text remains server-private input for subsequent reviewed preparation. */
export async function inspectHtmlSnapshotArchive(params: {
  identity: HtmlSnapshotInspectionIdentity; archiveBytes: Buffer; signal?: AbortSignal;
}) {
  try {
    params.signal?.throwIfAborted();
    const identity = identitySchema.parse(params.identity);
    if (params.archiveBytes.length !== identity.archiveBytes
      || createHash("sha256").update(params.archiveBytes).digest("hex") !== identity.projectHash) throw new Error();
    const bytes = await readHtmlSnapshotZipMember({ archiveBytes: params.archiveBytes,
      path: identity.bundlePin.path, maximumBytes: HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes, signal: params.signal });
    if (createHash("sha256").update(bytes).digest("hex") !== identity.bundlePin.sha256) throw new Error();
    const encodedBundle = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const bundle = { archivePath: identity.bundlePin.path, encodedBundle, sha256: identity.bundlePin.sha256 };
    const diagnostic = diagnoseCompositionHtmlEditingSnapshotCompatibility({ ...bundle,
      scope: { organizationId: identity.organizationId, documentId: identity.documentId }, documentHash: identity.documentHash });
    params.signal?.throwIfAborted();
    return { scope: "INSPECTED_ARCHIVE_CONTENT_NOT_AUTHORIZATION_OR_EXECUTION" as const,
      projectHash: identity.projectHash, bundleSha256: bundle.sha256, diagnostic, bundle };
  } catch {
    params.signal?.throwIfAborted();
    throw new Error("HTML_SNAPSHOT_INSPECTION_UNAVAILABLE");
  }
}
