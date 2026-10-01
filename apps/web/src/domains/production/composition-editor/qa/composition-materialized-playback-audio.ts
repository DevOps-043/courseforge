import { readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { playbackVisualFramesHash } from "./composition-playback-audio-contract";
import type { materializeConformanceReference } from "./composition-conformance-materialization";
import { captureMaterializedConformancePreview } from "./composition-conformance-visual-capture";
import { canonicalizeBrowserPlaybackAudio } from "./composition-playback-audio-canonicalization";
import { AUDIO_STREAM_LIMITS } from "./composition-audio-conformance-policy";

const defaults = {capture: captureMaterializedConformancePreview, canonicalize: canonicalizeBrowserPlaybackAudio};
/** Authorized frozen source → same-session visual witness/native playback → canonical PCM. */
export async function createMaterializedPlaybackAudioReference(params: {
  materialized: Awaited<ReturnType<typeof materializeConformanceReference>>; outputParentDirectory: string;
  ffmpegPath: string; allowLongAudio?: boolean;
}, dependencies: typeof defaults = defaults) {
  // Reject unsupported long production before launching the browser; inspect authorized contract bytes via capture as well.
  const contractPath = join(params.materialized.directory, "conformance-contract.json");
  const file = await lstat(contractPath);
  if (!file.isFile() || file.size > 1024 * 1024) throw new Error("AUDIO_PLAYBACK_CONTRACT_INVALID");
  const contract = compositionConformanceContractSchema.parse(JSON.parse(await readFile(contractPath, "utf8")));
  if (contract.canvas.durationSeconds > AUDIO_STREAM_LIMITS.legacyDurationSeconds && params.allowLongAudio !== true) {
    throw new Error("AUDIO_REFERENCE_LONG_AUDIO_UNSUPPORTED");
  }
  let capture: Awaited<ReturnType<typeof defaults.capture>> | null = null;
  let canonical: Awaited<ReturnType<typeof defaults.canonicalize>> | null = null;
  const cleanup = async () => {
    const results = await Promise.allSettled([
      ...(canonical ? [Promise.resolve().then(() => canonical!.cleanup())] : []),
      ...(capture ? [Promise.resolve().then(() => capture!.cleanup())] : []),
    ]);
    if (results.some((result) => result.status === "rejected")) throw new Error("AUDIO_PLAYBACK_REFERENCE_CLEANUP_FAILED");
  };
  try {
    capture = await dependencies.capture({...params, capturePlaybackAudio: true});
    if (!capture.playback) throw new Error("AUDIO_PLAYBACK_CAPTURE_MISSING");
    if (capture.playback.receipt.durationSeconds !== contract.canvas.durationSeconds) throw new Error("AUDIO_PLAYBACK_CONTRACT_MISMATCH");
    canonical = await dependencies.canonicalize({nativePath: capture.playback.audioReferencePath, receipt: capture.playback.receipt,
      outputParentDirectory: params.outputParentDirectory, ffmpegPath: params.ffmpegPath});
    const visualFramesSha256 = playbackVisualFramesHash(capture.receipt.frames);
    const receipt = {...canonical.receipt, visualFramesSha256, visualFrames: capture.receipt.frames};
    await writeFile(join(canonical.directory, "audio-reference-receipt.json"), JSON.stringify(receipt));
    return {directory: canonical.directory, receipt, cleanup};
  } catch (error) {await cleanup(); throw error;}
}
