import { readPersistedAudioConformanceEvidence } from "./composition-audio-evidence-reader";
import { compareVideoWithPersistedVisualReference } from "./composition-persisted-reference-comparison";
import { evaluatePlaybackAudioWitness } from "./composition-playback-audio-gate";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {requiresConformanceExecutionRecovery} from "./composition-conformance-stage-failure";

const defaultDependencies = { readAudio: readPersistedAudioConformanceEvidence, compare: compareVideoWithPersistedVisualReference };

/** Explicit silent route. Never reads or generates an audio reference; durable V1 still cannot store it. */
export async function compareVideoWithPersistedSilentReference(
  params: Omit<Parameters<typeof compareVideoWithPersistedVisualReference>[0],
    "audioReferencePath" | "audioReferenceMetadataPath" | "audioExpectation">,
  compare: typeof compareVideoWithPersistedVisualReference = compareVideoWithPersistedVisualReference,
) {
  return compare({...params, audioExpectation: "NOT_REQUIRED"});
}
/** Reads an exact visual/audio pair. Video integrity is a separate prerequisite; audio remains a source-derived model. */
export async function compareVideoWithPersistedConformanceReferences(
  params: Omit<Parameters<typeof compareVideoWithPersistedVisualReference>[0], "audioReferencePath" | "audioReferenceMetadataPath">
    & { audioChecksum: string; signal?: AbortSignal }, dependencies: typeof defaultDependencies = defaultDependencies,
) {
  assertConformanceJobActive(params.signal);
  const audio = await dependencies.readAudio({ ...params, visualChecksum: params.checksum, checksum: params.audioChecksum });
  let recoveryRequired = false;
  try {
    assertConformanceJobActive(params.signal);
    if (audio.receipt.visualChecksum !== params.checksum || audio.receipt.organizationId !== params.organizationId
      || audio.receipt.revisionId !== params.revisionId)
      throw new Error("AUDIO_EVIDENCE_COMPARISON_REVISION_MISMATCH");
    const result = await dependencies.compare({ ...params, audioReferencePath: audio.audioReferencePath,
      audioReferenceMetadataPath: audio.audioReferenceMetadataPath });
    assertConformanceJobActive(params.signal);
    if (result.reference.checksum !== audio.receipt.visualChecksum
      || result.reference.projectHash !== audio.receipt.projectHash || result.reference.documentHash !== audio.receipt.documentHash
      || result.reference.organizationId !== audio.receipt.organizationId || result.reference.revisionId !== audio.receipt.revisionId) {
      throw new Error("AUDIO_EVIDENCE_COMPARISON_REVISION_MISMATCH");
    }
    if (result.report.audioTiming.status === "NOT_REQUESTED") throw new Error("AUDIO_EVIDENCE_COMPARISON_AUDIO_SKIPPED");
    if (result.report.status === "PASS" && result.report.audioTiming.rms?.status !== "PASS") {
      throw new Error("AUDIO_EVIDENCE_COMPARISON_RMS_SKIPPED");
    }
    const audioPlayback = audio.receipt.schemaVersion === 3
      ? evaluatePlaybackAudioWitness(audio.receipt.playback, result.report.audioTiming, audio.contract.canvas.fps, audio.receipt.clipCount) : undefined;
    const status = result.report.status === "FAIL" || audioPlayback?.status === "FAIL" ? "FAIL" as const
      : result.report.status === "INCOMPLETE" || audioPlayback?.status === "INCOMPLETE" ? "INCOMPLETE" as const : "PASS" as const;
    return { ...result, report: {...result.report, status, ...(audioPlayback ? {audioPlayback} : {})}, audioReference: { checksum: audio.checksum, receipt: audio.receipt,
      provenance: audio.receipt.schemaVersion === 3 ? "SCOPED_WORKER_PLAYBACK_AUDIO_EVIDENCE" as const : "SCOPED_WORKER_SOURCE_AUDIO_EVIDENCE" as const } };
  } catch (error) {
    recoveryRequired = requiresConformanceExecutionRecovery(error);
    throw error;
  } finally {
    if (!recoveryRequired) {
      try { await audio.cleanup(); } catch { throw new Error("AUDIO_EVIDENCE_COMPARISON_CLEANUP_FAILED"); }
    }
  }
}
