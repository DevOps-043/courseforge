import { z } from "zod";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";

export const HTML_SNAPSHOT_INSPECTION_POLICY = Object.freeze({ timeoutMs: 120_000, responseBytes: 16 * 1024 });
export const htmlSnapshotInspectionReadRequestSchema = z.object({
  actorId: z.string().uuid(), organizationId: z.string().uuid(), compositionId: z.string().uuid(),
  draftId: z.string().uuid(), revisionId: z.string().uuid(),
}).strict();
export type HtmlSnapshotInspectionReadRequest = z.infer<typeof htmlSnapshotInspectionReadRequestSchema>;
const diagnosticScope = z.literal("OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION");
const diagnosticSchema = z.union([
  z.object({ scope: diagnosticScope, status: z.literal("REJECTED"), reason: z.enum([
    "INVALID_BUNDLE", "BYTE_INTEGRITY_MISMATCH", "SCOPE_MISMATCH", "AUTHORITY_SET_MISMATCH",
    "COMPILATION_VERSION_MISMATCH", "COMPILATION_OUTPUT_MISMATCH",
  ]) }).strict(),
  z.object({ scope: diagnosticScope, status: z.enum(["CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS",
    "LEGACY_V1_REQUIRES_REVIEW", "PROFILE_MISMATCH_REQUIRES_REVIEW"]), revisionCount: z.number().int().min(1).max(HTML_EDITING_LIMITS.elements),
    profileDifferences: z.array(z.enum(["compilerVersion", "geometryVersion", "isolationVersion"])).max(3)
      .refine(values => new Set(values).size === values.length),
  }).strict().refine(diagnostic => diagnostic.status === "PROFILE_MISMATCH_REQUIRES_REVIEW"
    ? diagnostic.profileDifferences.length > 0 : diagnostic.profileDifferences.length === 0),
]);
export const htmlSnapshotInspectionResultSchema = htmlSnapshotInspectionReadRequestSchema.extend({
  scope: z.literal("AUTHORIZED_ARCHIVE_DIAGNOSTIC_NOT_EXECUTION_OR_PUBLICATION"),
  documentId: z.string().uuid(), documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  projectHash: z.string().regex(/^[a-f0-9]{64}$/), bundleSha256: z.string().regex(/^[a-f0-9]{64}$/),
  diagnostic: diagnosticSchema,
}).strict();
export type HtmlSnapshotInspectionResult = z.infer<typeof htmlSnapshotInspectionResultSchema>;
export function matchesHtmlSnapshotInspection(result: HtmlSnapshotInspectionResult, request: HtmlSnapshotInspectionReadRequest) {
  return (Object.keys(request) as Array<keyof HtmlSnapshotInspectionReadRequest>).every(key => result[key] === request[key]);
}
