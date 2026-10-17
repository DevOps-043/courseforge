import { materializeAuthorizedConformanceRevision } from "./composition-conformance-storage";
import { createMaterializedAudioReference } from "./composition-audio-reference";
import { compareVideoWithPersistedVisualReference } from "./composition-persisted-reference-comparison";

const defaultDependencies = { materialize: materializeAuthorizedConformanceRevision,
  createAudio: createMaterializedAudioReference, compare: compareVideoWithPersistedVisualReference };

/** Worker orchestration; video integrity remains a separate prerequisite. Audio is a source-derived model, not browser capture. */
export async function compareVideoWithSourceAudioReference(
  params: Omit<Parameters<typeof compareVideoWithPersistedVisualReference>[0], "audioReferencePath" | "audioReferenceMetadataPath">
    & { supabaseUrl: string; ffmpegPath: string },
  dependencies: typeof defaultDependencies = defaultDependencies,
) {
  let materialized: Awaited<ReturnType<typeof materializeAuthorizedConformanceRevision>> | null = null;
  let audio: Awaited<ReturnType<typeof createMaterializedAudioReference>> | null = null;
  try {
    materialized = await dependencies.materialize(params);
    audio = await dependencies.createAudio({ materialized, outputParentDirectory: params.outputParentDirectory, ffmpegPath: params.ffmpegPath });
    const comparison = await dependencies.compare({ ...params,
      audioReferencePath: audio.audioReferencePath, audioReferenceMetadataPath: audio.audioReferenceMetadataPath });
    if (comparison.reference.documentHash !== audio.receipt.documentHash
      || comparison.reference.projectHash !== audio.receipt.projectHash
      || comparison.reference.organizationId !== audio.receipt.organizationId
      || comparison.reference.revisionId !== audio.receipt.revisionId) throw new Error("AUDIO_REFERENCE_COMPARISON_REVISION_MISMATCH");
    return { ...comparison, audioReference: audio.receipt };
  } finally {
    const cleanups = await Promise.allSettled([
      ...(audio ? [Promise.resolve().then(() => audio!.cleanup())] : []),
      ...(materialized ? [Promise.resolve().then(() => materialized!.cleanup())] : []),
    ]);
    if (cleanups.some((result) => result.status === "rejected")) throw new Error("AUDIO_REFERENCE_COMPARISON_CLEANUP_FAILED");
  }
}
