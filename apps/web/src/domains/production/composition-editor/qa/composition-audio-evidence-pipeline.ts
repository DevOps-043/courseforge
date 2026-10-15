import { materializeAuthorizedConformanceRevision } from "./composition-conformance-storage";
import { createMaterializedAudioReference } from "./composition-audio-reference";
import { persistAudioConformanceEvidence } from "./composition-audio-evidence-persistence";
import { audioEvidenceHashSchema } from "./composition-audio-evidence-contract";
import { createMaterializedPlaybackAudioReference } from "./composition-materialized-playback-audio";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import {requiresConformanceExecutionRecovery} from "./composition-conformance-stage-failure";

const defaultDependencies = { materialize: materializeAuthorizedConformanceRevision, createAudio: createMaterializedAudioReference,
  persist: persistAudioConformanceEvidence };
type Dependencies = typeof defaultDependencies & {createPlaybackAudio?: typeof createMaterializedPlaybackAudioReference};
/** Worker preparation only. Does not enqueue a durable conformance job or approve the video. */
export async function prepareAndPersistAudioConformanceReference(
  params: Parameters<typeof materializeAuthorizedConformanceRevision>[0] & { visualChecksum: string; ffmpegPath: string; allowLongAudio?: boolean; capturePlaybackAudio?: boolean; signal?: AbortSignal },
  dependencies: Dependencies = defaultDependencies,
) {
  audioEvidenceHashSchema.parse(params.visualChecksum);
  let materialized: Awaited<ReturnType<typeof materializeAuthorizedConformanceRevision>> | null = null;
  let audio: {directory: string; cleanup: () => Promise<void>} | null = null;
  let recoveryRequired = false;
  try {
    assertConformanceJobActive(params.signal);
    materialized = await dependencies.materialize(params);
    assertConformanceJobActive(params.signal);
    const createAudio = params.capturePlaybackAudio === true ? (dependencies.createPlaybackAudio ?? createMaterializedPlaybackAudioReference) : dependencies.createAudio;
    audio = await createAudio({ materialized, outputParentDirectory: params.outputParentDirectory,
      ffmpegPath: params.ffmpegPath, allowLongAudio: params.allowLongAudio });
    assertConformanceJobActive(params.signal);
    const persisted = await dependencies.persist({ ...params, audioDirectory: audio.directory });
    assertConformanceJobActive(params.signal); return persisted;
  } catch (error) {
    recoveryRequired = requiresConformanceExecutionRecovery(error);
    throw error;
  } finally {
    if (!recoveryRequired) {
      const cleanups = await Promise.allSettled([
        ...(audio ? [Promise.resolve().then(() => audio!.cleanup())] : []),
        ...(materialized ? [Promise.resolve().then(() => materialized!.cleanup())] : []),
      ]);
      if (cleanups.some((result) => result.status === "rejected")) throw new Error("AUDIO_EVIDENCE_PIPELINE_CLEANUP_FAILED");
    }
  }
}
