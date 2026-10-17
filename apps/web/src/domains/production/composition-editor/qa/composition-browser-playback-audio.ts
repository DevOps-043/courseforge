import { createHash } from "node:crypto";
import { mkdtemp, open, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION } from "../composition-playback-audio-envelope";
import type { CompositionQaCdpClient } from "./composition-qa-browser";
import { stereoFloatWavHeader } from "./composition-pcm-wav";
import { PLAYBACK_CAPTURE_POLICY, PLAYBACK_CAPTURE_WORKLET, playbackCaptureInstallExpression } from "./composition-playback-capture-runtime";
import { PlaybackPcmConsumer } from "./composition-playback-pcm-consumer";
import type { MediaBoundaryWindow } from "./composition-playback-boundaries";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string, userGesture = false): Promise<T> {
  const response = await client.send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true, userGesture});
  const result = response.result as {value?: T} | undefined;
  if (response.exceptionDetails || !result || !("value" in result)) throw new Error("AUDIO_PLAYBACK_RUNTIME_FAILED");
  return result.value as T;
}
const installationSchema = z.object({sampleRate: z.literal(PLAYBACK_CAPTURE_POLICY.sampleRate),
  mediaCount: z.number().int().nonnegative().max(PLAYBACK_CAPTURE_POLICY.maximumMediaElements)}).strict();

/** Live output of an already authorized, isolated preview; caller owns browser and pinned sources. */
export async function captureBrowserPlaybackAudio(params: {
  client: CompositionQaCdpClient; workletUrl: string; outputParentDirectory: string; durationSeconds: number;
  expectedMediaWindows?: MediaBoundaryWindow[];
  receipt: {schemaVersion: number; organizationId: string; revisionId: string; projectHash: string; documentHash: string;
    assetCount: number; mediaBytes: number};
}) {
  const consumer = new PlaybackPcmConsumer(params.durationSeconds);
  const directory = await mkdtemp(join(resolve(params.outputParentDirectory), "conformance-playback-audio-"));
  const names = ["audio-reference.wav", "audio-reference-metadata.json", "audio-reference-receipt.json"];
  const cleanup = async () => {
    for (const name of names) await rm(join(directory, name), {force: true});
    await rmdir(directory).catch((error: NodeJS.ErrnoException) => {if (error.code !== "ENOENT") throw error;});
  };
  let installed = false; let captured: Awaited<ReturnType<typeof capture>>;
  async function capture() {
    const installedValue = await evaluate(params.client, playbackCaptureInstallExpression(params.workletUrl, params.durationSeconds, params.expectedMediaWindows));
    installed = true;
    const installation = installationSchema.parse(installedValue);
    const destination = await open(join(directory, names[0]!), "wx", 0o600);
    const digest = createHash("sha256");
    let lastBatch: Awaited<ReturnType<PlaybackPcmConsumer["consume"]>> | null = null;
    try {
      const header = stereoFloatWavHeader(consumer.expectedFrames * 8, PLAYBACK_CAPTURE_POLICY.sampleRate);
      await destination.writeFile(header); digest.update(header);
      const startupDeadline = Date.now() + PLAYBACK_CAPTURE_POLICY.startupMilliseconds;
      const deadline = Date.now() + params.durationSeconds * 1000 + PLAYBACK_CAPTURE_POLICY.completionGraceMilliseconds;
      await evaluate(params.client, "window.__courseforgePlaybackCapture.start().then(() => true)", true);
      while (!consumer.complete || !lastBatch?.done) {
        if (Date.now() > deadline) throw new Error("AUDIO_PLAYBACK_TIMEOUT");
        const input = await evaluate<unknown>(params.client, "window.__courseforgePlaybackCapture.pull()");
        if (Buffer.byteLength(JSON.stringify(input)) > 256 * 1024) throw new Error("AUDIO_PLAYBACK_BATCH_LIMIT");
        lastBatch = await consumer.consume(input, async (bytes) => {await destination.writeFile(bytes); digest.update(bytes);});
        if (lastBatch.originFrame === null && Date.now() > startupDeadline) throw new Error("AUDIO_PLAYBACK_START_TIMEOUT");
        if (!consumer.complete || !lastBatch.done) await new Promise((next) => setTimeout(next, PLAYBACK_CAPTURE_POLICY.pollMilliseconds));
      }
      // Observe deferred pause/ended events after the composition's final playback message.
      if (params.expectedMediaWindows !== undefined) {
        await new Promise((next) => setTimeout(next, PLAYBACK_CAPTURE_POLICY.pollMilliseconds));
        lastBatch = await consumer.consume(await evaluate(params.client, "window.__courseforgePlaybackCapture.pull()"), async (bytes) => {
          await destination.writeFile(bytes); digest.update(bytes);
        });
      }
    } finally {await destination.close();}
    const samples = consumer.finish(); const audioSha256 = digest.digest("hex");
    const receipt = {...params.receipt, schemaVersion: 3, method: "BROWSER_MEDIA_OUTPUT_PCM_V3",
      status: "BROWSER_PLAYBACK_CAPTURED", audioEnvelopeVersion: COMPOSITION_PLAYBACK_AUDIO_ENVELOPE_VERSION,
      durationSeconds: params.durationSeconds, sampleRate: PLAYBACK_CAPTURE_POLICY.sampleRate, channels: 2,
      audioSha256, peak: samples.peak, clipCount: params.expectedMediaWindows?.length ?? installation.mediaCount, decodedAssetCount: 0,
      playback: {policy: PLAYBACK_CAPTURE_POLICY.id, workletSha256: createHash("sha256").update(PLAYBACK_CAPTURE_WORKLET).digest("hex"),
        originFrame: samples.originFrame, sampleCount: samples.sampleCount, packetCount: lastBatch!.packetCount,
        eventCount: lastBatch!.eventCount, maxClockDriftMilliseconds: lastBatch!.maxClockDriftMilliseconds,
        maxMediaDriftMilliseconds: lastBatch!.maxMediaDriftMilliseconds,
        quantumMilliseconds: lastBatch!.largestBlockFrames * 1000 / PLAYBACK_CAPTURE_POLICY.sampleRate,
        ...(lastBatch!.boundaries ? {boundaries: lastBatch!.boundaries} : {}),
        observation: "BROWSER_MEDIA_GRAPH_NOT_PHYSICAL_DEVICE_OR_SEMANTIC_LIP_SYNC"},
    };
    await writeFile(join(directory, names[1]!), JSON.stringify({documentHash: receipt.documentHash, audioSha256}), {flag: "wx", mode: 0o600});
    await writeFile(join(directory, names[2]!), JSON.stringify(receipt), {flag: "wx", mode: 0o600});
    return {directory, audioReferencePath: join(directory, names[0]!), audioReferenceMetadataPath: join(directory, names[1]!), receipt, cleanup};
  }
  try {captured = await capture();}
  catch (error) {await cleanup(); throw error;}
  finally {
    if (installed) {
      try {await evaluate(params.client, "window.__courseforgePlaybackCapture.stop().then(() => true)");}
      catch {await cleanup(); throw new Error("AUDIO_PLAYBACK_CLOSE_FAILED");}
    }
  }
  return captured;
}
