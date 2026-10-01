import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { prepareAndPersistVisualConformanceReference } from "./composition-conformance-reference-pipeline";
import { prepareAndPersistAudioConformanceReference } from "./composition-audio-evidence-pipeline";
import { compareVideoWithPersistedConformanceReferences } from "./composition-persisted-audio-comparison";
import { conformanceJobClaimSchema, durableConformanceReportSchema, type ConformanceJobClaim } from "./composition-conformance-job-worker";
import { resolveExportedColorTagPolicyId, type ExportedColorTagPolicyId } from "./composition-exported-color-tags";

const integritySchema = z.object({ assetId: z.string().uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive().max(2 * 1024 ** 3), status: z.literal("MATCH") }).strict();
type IntegrityResult = z.infer<typeof integritySchema>;
type IntegrityScope = { supabase: SupabaseClient<any, any, any>; supabaseUrl: string; organizationId: string; requestId: string };
export type ConformanceIntegrityAdapters = {
  snapshot: (params: IntegrityScope & { destinationPath: string }) => Promise<IntegrityResult>;
  recheck: (params: IntegrityScope) => Promise<IntegrityResult>;
};
const defaultEvidence = { visual: prepareAndPersistVisualConformanceReference, audio: prepareAndPersistAudioConformanceReference,
  compare: compareVideoWithPersistedConformanceReferences };

/** Worker-only: MP4 streamed by the integrity service, exact persisted references and a second remote check. */
export async function executeConformanceJob(params: {
  claim: ConformanceJobClaim; supabase: SupabaseClient<any, any, any>; supabaseUrl: string; ffmpegPath: string; allowLongAudio?: boolean; capturePlaybackAudio?: boolean;
  colorTagPolicyId?: ExportedColorTagPolicyId;
}, integrity: ConformanceIntegrityAdapters, evidence: typeof defaultEvidence = defaultEvidence) {
  const claim = conformanceJobClaimSchema.parse(params.claim);
  resolveExportedColorTagPolicyId(params.colorTagPolicyId);
  const directory = await mkdtemp(join(tmpdir(), "composition-conformance-job-"));
  const videoPath = join(directory, "final.mp4");
  const renderReceiptPath = join(directory, "receipt.json");
  const scope = { supabase: params.supabase, supabaseUrl: params.supabaseUrl,
    organizationId: claim.organization_id, requestId: claim.request_id };
  const preparation = { ...scope, revisionId: claim.revision_id, outputParentDirectory: directory };
  try {
    const before = integritySchema.parse(await integrity.snapshot({ ...scope, destinationPath: videoPath }));
    const visual = await evidence.visual(preparation);
    if (visual.documentHash !== before.documentHash || visual.organizationId !== scope.organizationId
      || visual.revisionId !== claim.revision_id) throw new Error("CONFORMANCE_JOB_REVISION_MISMATCH");
    const audio = await evidence.audio({ ...preparation, visualChecksum: visual.checksum,
      ffmpegPath: params.ffmpegPath, allowLongAudio: params.allowLongAudio, capturePlaybackAudio: params.capturePlaybackAudio });
    await writeFile(renderReceiptPath, JSON.stringify({ documentHash: before.documentHash, videoSha256: before.checksum }),
      { flag: "wx", mode: 0o600 });
    const comparison = await evidence.compare({ ...preparation, checksum: visual.checksum, audioChecksum: audio.checksum,
      videoPath, renderReceiptPath, audioPolicyId: "course-v1",
      ...(params.colorTagPolicyId ? {colorTagPolicyId: params.colorTagPolicyId} : {}) });
    if (params.colorTagPolicyId && comparison.report.colorTags?.policy !== params.colorTagPolicyId) {
      throw new Error("CONFORMANCE_JOB_COLOR_TAG_EVIDENCE_MISSING_INVALID");
    }
    if (params.capturePlaybackAudio === true && (audio.receipt?.schemaVersion !== 3 || comparison.audioReference.receipt?.schemaVersion !== 3 || !comparison.report.audioPlayback)) {
      throw new Error("CONFORMANCE_JOB_PLAYBACK_EVIDENCE_MISSING_INVALID");
    }
    if (comparison.reference.documentHash !== before.documentHash || comparison.reference.projectHash !== visual.projectHash
      || comparison.reference.organizationId !== scope.organizationId || comparison.reference.revisionId !== claim.revision_id
      || comparison.reference.checksum !== visual.checksum || comparison.audioReference.checksum !== audio.checksum) {
      throw new Error("CONFORMANCE_JOB_REFERENCE_MISMATCH");
    }
    const after = integritySchema.parse(await integrity.recheck(scope));
    if ((["assetId", "checksum", "documentHash", "sizeBytes"] as const).some((key) => before[key] !== after[key])) {
      throw new Error("CONFORMANCE_JOB_REMOTE_CHANGED_INVALID");
    }
    const { status: _integrityStatus, ...boundIntegrity } = before;
    return durableConformanceReportSchema.parse({ reportVersion: 1, scope: "REMOTE_INTEGRITY_AND_PERSISTED_CONFORMANCE",
      status: comparison.report.status, organizationId: scope.organizationId, requestId: scope.requestId, revisionId: claim.revision_id,
      integrity: boundIntegrity, references: { visualChecksum: visual.checksum, audioChecksum: audio.checksum }, comparison: comparison.report,
      limitations: [params.capturePlaybackAudio === true ? "BROWSER_AUDIO_GRAPH_NOT_PHYSICAL_OUTPUT" : "SOURCE_AUDIO_MODEL_NOT_PLAYBACK_CAPTURE", "AUDIO_ENVELOPE_NOT_CONTENT_IDENTITY",
        ...(comparison.report.visual?.fontUsage ? [comparison.report.visual.fontUsage.reason] : []),
        "NOT_A_SIGNED_ATTESTATION", "REMOTE_OBJECT_CAN_CHANGE_AFTER_CHECK", "NOT_QA_OR_PUBLICATION_APPROVAL"] });
  } finally {
    const cleanups = await Promise.allSettled([rm(videoPath, { force: true }), rm(renderReceiptPath, { force: true })]);
    if (cleanups.some((result) => result.status === "rejected")) throw new Error("CONFORMANCE_JOB_CLEANUP_FAILED");
    // Never recursively remove unknown files left by another stage; surface failed stage cleanup.
    try { await rmdir(directory); } catch { throw new Error("CONFORMANCE_JOB_CLEANUP_FAILED"); }
  }
}
