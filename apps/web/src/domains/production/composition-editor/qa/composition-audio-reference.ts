import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION } from "../composition-playback-audio-envelope";
import type { materializeConformanceReference } from "./composition-conformance-materialization";
import {
  AUDIO_REFERENCE_LIMITS,
  buildAudioReferenceMixPlan,
  encodeAudioReferenceWavHeader,
  iterateAudioReferencePcm,
} from "./composition-audio-reference-mix";
import { AUDIO_STREAM_LIMITS } from "./composition-audio-conformance-policy";

const execute = promisify(execFile);
export function audioReferenceDecodeArguments(path: string) {
  if (!path || path.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(path))
    throw new Error("AUDIO_REFERENCE_PATH_INVALID");
  return [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    resolve(path),
    "-map",
    "0:a:0",
    "-vn",
    "-t",
    String(AUDIO_REFERENCE_LIMITS.sourceSeconds + 1),
    "-af",
    "aresample=8000:async=1:first_pts=0",
    "-ac",
    "2",
    "-ar",
    String(AUDIO_REFERENCE_LIMITS.sampleRate),
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    "pipe:1",
  ];
}
async function verifyMedia(
  path: string,
  expected: { checksum: string; fileSizeBytes: number },
) {
  const file = await lstat(path);
  if (!file.isFile() || file.size !== expected.fileSizeBytes)
    throw new Error("AUDIO_REFERENCE_SOURCE_CHANGED");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += (chunk as Buffer).length;
    if (size > expected.fileSizeBytes)
      throw new Error("AUDIO_REFERENCE_SOURCE_CHANGED");
    hash.update(chunk as Buffer);
  }
  if (
    size !== expected.fileSizeBytes ||
    hash.digest("hex") !== expected.checksum
  )
    throw new Error("AUDIO_REFERENCE_SOURCE_CHANGED");
}
async function boundedText(path: string) {
  const file = await lstat(path);
  if (!file.isFile() || file.size > AUDIO_REFERENCE_LIMITS.sourceTextBytes)
    throw new Error("AUDIO_REFERENCE_SOURCE_INVALID");
  const bytes = await readFile(path);
  if (bytes.length !== file.size)
    throw new Error("AUDIO_REFERENCE_SOURCE_CHANGED");
  return bytes.toString("utf8");
}

/** Source-derived reference using preview mixing rules; caller owns an exclusively used authorized materialization. */
export async function createMaterializedAudioReference(
  params: {
    materialized: Awaited<ReturnType<typeof materializeConformanceReference>>;
    outputParentDirectory: string;
    ffmpegPath: string;
    allowLongAudio?: boolean;
  },
  decodePcm?: (path: string) => Promise<Buffer>,
) {
  const root = params.materialized.directory;
  const previewHtml = await boundedText(join(root, "conformance-preview.html"));
  const source = verifyConformanceReferenceSource({
    previewHtml,
    documentJson: await boundedText(join(root, "composition-document.json")),
    contractJson: await boundedText(join(root, "conformance-contract.json")),
    metadata: JSON.parse(
      await boundedText(join(root, "conformance-reference.json")),
    ),
  });
  if (source.metadata.documentHash !== params.materialized.receipt.documentHash)
    throw new Error("AUDIO_REFERENCE_REVISION_MISMATCH");
  const plan = buildAudioReferenceMixPlan(source.document);
  const longAudio =
    plan.durationSeconds > AUDIO_STREAM_LIMITS.legacyDurationSeconds;
  if (longAudio && params.allowLongAudio !== true)
    throw new Error("AUDIO_REFERENCE_LONG_AUDIO_UNSUPPORTED");
  if (
    source.document.transitions?.items.some(
      (transition) => transition.audioMode === "CROSSFADE",
    ) &&
    !previewHtml.includes(
      `window.__courseforgeAudioEnvelopeVersion = ${COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION};`,
    )
  ) {
    throw new Error("AUDIO_REFERENCE_LEGACY_CROSSFADE_ENVELOPE");
  }
  if (
    plan.clips.some((clip) => clip.loop && clip.points.length > 0) &&
    !previewHtml.includes(
      'document.getElementById(automation.targetClipId + "-audio")',
    )
  ) {
    throw new Error("AUDIO_REFERENCE_LEGACY_VIDEO_AUTOMATION");
  }
  const bindings = new Map(
    source.metadata.bindings.map((binding) => [binding.assetId, binding]),
  );
  const sources = new Map<string, Buffer>();
  let decodedBytes = 0;
  const deadline =
    Date.now() + AUDIO_REFERENCE_LIMITS.decodeDeadlineMilliseconds;
  for (const assetId of new Set(plan.clips.map((clip) => clip.assetId))) {
    const binding = bindings.get(assetId);
    if (!binding) throw new Error("AUDIO_REFERENCE_BINDING_MISSING");
    const path = join(root, binding.localPath);
    await verifyMedia(path, binding);
    const remainingTime = deadline - Date.now();
    if (remainingTime <= 0) throw new Error("AUDIO_REFERENCE_DECODE_TIMEOUT");
    const remainingDecodedBytes = AUDIO_REFERENCE_LIMITS.decodedBytes - decodedBytes;
    if (remainingDecodedBytes <= 0) throw new Error("AUDIO_REFERENCE_PCM_LIMIT");
    const pcm = decodePcm
      ? await decodePcm(path)
      : (
          await execute(
            params.ffmpegPath,
            audioReferenceDecodeArguments(path),
            {
              encoding: "buffer",
              windowsHide: true,
              timeout: remainingTime,
              maxBuffer: Math.min(
                AUDIO_REFERENCE_LIMITS.sampleRate *
                  (AUDIO_REFERENCE_LIMITS.sourceSeconds + 1) *
                  8,
                remainingDecodedBytes,
              ),
            },
          )
        ).stdout;
    if (Date.now() > deadline)
      throw new Error("AUDIO_REFERENCE_DECODE_TIMEOUT");
    decodedBytes += pcm.length;
    if (
      pcm.length >
        AUDIO_REFERENCE_LIMITS.sampleRate *
          AUDIO_REFERENCE_LIMITS.sourceSeconds *
          8 ||
      decodedBytes > AUDIO_REFERENCE_LIMITS.decodedBytes
    )
      throw new Error("AUDIO_REFERENCE_PCM_LIMIT");
    await verifyMedia(path, binding);
    sources.set(assetId, pcm);
  }
  for (const assetId of sources.keys()) {
    const binding = bindings.get(assetId)!;
    await verifyMedia(join(root, binding.localPath), binding);
  }
  const assetCount = sources.size;
  const directory = await mkdtemp(
    join(resolve(params.outputParentDirectory), "conformance-audio-"),
  );
  const names = [
    "audio-reference.wav",
    "audio-reference-metadata.json",
    "audio-reference-receipt.json",
  ];
  const cleanup = async () => {
    for (const name of names) await rm(join(directory, name), { force: true });
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  };
  try {
    const destination = await open(join(directory, names[0]!), "wx", 0o600);
    const digest = createHash("sha256");
    let peak = 0;
    try {
      const header = encodeAudioReferenceWavHeader(
        Math.ceil(plan.durationSeconds * AUDIO_REFERENCE_LIMITS.sampleRate) * 8,
      );
      await destination.writeFile(header);
      digest.update(header);
      for (const chunk of iterateAudioReferencePcm(plan, sources)) {
        await destination.writeFile(chunk.pcm);
        digest.update(chunk.pcm);
        peak = Math.max(peak, chunk.peak);
      }
    } finally {
      await destination.close();
      sources.clear();
    }
    const checksum = digest.digest("hex");
    const receipt = {
      ...params.materialized.receipt,
      ...(longAudio
        ? {
            schemaVersion: 2 as const,
            method: "PREVIEW_RULES_STEREO_PCM_CHUNKED_V2" as const,
            mixChunkFrames: AUDIO_STREAM_LIMITS.mixChunkFrames,
          }
        : {
            schemaVersion: 1 as const,
            method: "PREVIEW_RULES_STEREO_PCM_V1" as const,
          }),
      status: "SOURCE_MIX_REFERENCE_NOT_PLAYBACK_CAPTURE" as const,
      documentHash: source.metadata.documentHash,
      audioEnvelopeVersion: COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION,
      audioSha256: checksum,
      durationSeconds: plan.durationSeconds,
      sampleRate: AUDIO_REFERENCE_LIMITS.sampleRate,
      channels: 2,
      clipCount: plan.clips.length,
      decodedAssetCount: assetCount,
      peak,
    };
    await writeFile(
      join(directory, names[1]!),
      JSON.stringify({
        documentHash: source.metadata.documentHash,
        audioSha256: checksum,
      }),
      { flag: "wx", mode: 0o600 },
    );
    await writeFile(join(directory, names[2]!), JSON.stringify(receipt), {
      flag: "wx",
      mode: 0o600,
    });
    return {
      directory,
      audioReferencePath: join(directory, names[0]!),
      audioReferenceMetadataPath: join(directory, names[1]!),
      receipt,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
