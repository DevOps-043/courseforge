import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { AUDIO_TIMING_POLICY, AUDIO_RMS_WINDOW_POLICY, AUDIO_STREAM_LIMITS } from "./composition-audio-conformance-policy";
import { StereoPcmEnergyAccumulator } from "./composition-pcm-energy-stream";
import { consumeDecodedPcm } from "./composition-pcm-decoder-stream";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import { audioRmsWindowReport, buildStereoPcmEnergyWindows, compareStereoRmsWindows, type AudioRmsWindowReport } from "./composition-audio-rms-windows";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";

export { AUDIO_TIMING_POLICY } from "./composition-audio-conformance-policy";

const metadataSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), audioSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export interface AudioTimingReport {
  status: "NOT_REQUESTED" | "PASS" | "FAIL" | "INCOMPLETE" | "MEASUREMENT_FAILED";
  method: "STEREO_ENERGY_ENVELOPE_STREAM_V3";
  policy: typeof AUDIO_TIMING_POLICY;
  lagMilliseconds: number | null;
  correlation: number | null;
  reason: string | null;
  referenceSha256: string | null;
  effectiveToleranceMilliseconds: number;
  /** Grid/quantization budget only; this is not a statistical bound on A/V or decoder error. */
  lagQuantizationBoundsMilliseconds: { minimum: number; maximum: number } | null;
  rms: AudioRmsWindowReport;
  alignment: { status: AudioTimingReport["status"]; reason: string | null } | null;
}
export function audioTimingReport(status: AudioTimingReport["status"], reason: string | null = null): AudioTimingReport {
  return { status, method: "STEREO_ENERGY_ENVELOPE_STREAM_V3", policy: AUDIO_TIMING_POLICY,
    lagMilliseconds: null, lagQuantizationBoundsMilliseconds: null, correlation: null, reason, referenceSha256: null,
    effectiveToleranceMilliseconds: AUDIO_TIMING_POLICY.toleranceMilliseconds,
    rms: audioRmsWindowReport("NOT_REQUESTED"), alignment: null };
}

/** f32le packed stereo, converted to RMS per channel without cancelling opposite phases. */
export function buildStereoEnergyEnvelope(pcm: Buffer): [number[], number[]] {
  return buildStereoPcmEnergyWindows(pcm, AUDIO_TIMING_POLICY.binMilliseconds).channels;
}

function correlationAt(reference: number[], rendered: number[], lag: number): number | null {
  const start = Math.max(0, -lag); const end = Math.min(reference.length, rendered.length - lag);
  let meanReference = 0; let meanRendered = 0;
  let varianceReference = 0; let varianceRendered = 0; let covariance = 0;
  for (let index = start; index < end; index++) {
    const left = reference[index]!; const right = rendered[index + lag]!;
    const sampleCount = index - start + 1;
    const deltaReference = left - meanReference; const deltaRendered = right - meanRendered;
    meanReference += deltaReference / sampleCount; meanRendered += deltaRendered / sampleCount;
    // Online centered moments avoid cancellation falsely certifying long, flat envelopes.
    varianceReference += deltaReference * (left - meanReference);
    varianceRendered += deltaRendered * (right - meanRendered);
    covariance += deltaReference * (right - meanRendered);
  }
  const count = end - start;
  if (count * AUDIO_TIMING_POLICY.binMilliseconds < AUDIO_TIMING_POLICY.minimumDurationMilliseconds
    || varianceReference <= 1e-12 || varianceRendered <= 1e-12) return null;
  return Math.max(-1, Math.min(1, covariance / Math.sqrt(varianceReference * varianceRendered)));
}

export function compareStereoEnergyEnvelopes(reference: [number[], number[]], rendered: [number[], number[]], frameDurationMilliseconds?: number): AudioTimingReport {
  if (frameDurationMilliseconds !== undefined && (!Number.isFinite(frameDurationMilliseconds) || frameDurationMilliseconds <= 0)) {
    throw new Error("AUDIO_TIMING_FRAME_DURATION_INVALID");
  }
  const effectiveToleranceMilliseconds = Math.min(AUDIO_TIMING_POLICY.toleranceMilliseconds, frameDurationMilliseconds ?? Infinity);
  const maximumBins = (AUDIO_TIMING_POLICY.maximumDurationSeconds + 1) * 1000 / AUDIO_TIMING_POLICY.binMilliseconds;
  for (const envelope of [reference, rendered]) {
    if (envelope[0].length !== envelope[1].length || envelope[0].length > maximumBins
      || envelope.some((channel) => channel.some((sample) => !Number.isFinite(sample) || sample < 0 || sample > 32))) {
      throw new Error("AUDIO_TIMING_ENVELOPE_INVALID");
    }
  }
  if (Math.min(reference[0].length, rendered[0].length) * AUDIO_TIMING_POLICY.binMilliseconds
    < AUDIO_TIMING_POLICY.minimumDurationMilliseconds) return audioTimingReport("INCOMPLETE", "INSUFFICIENT_DURATION");
  if (Math.abs(reference[0].length - rendered[0].length) * AUDIO_TIMING_POLICY.binMilliseconds > AUDIO_TIMING_POLICY.toleranceMilliseconds) {
    return audioTimingReport("FAIL", "AUDIO_DURATION_MISMATCH");
  }
  const informative: number[] = [];
  for (let channel = 0; channel < 2; channel++) {
    const activeReference = reference[channel]!.some((value) => value > AUDIO_TIMING_POLICY.silenceRms);
    const activeRendered = rendered[channel]!.some((value) => value > AUDIO_TIMING_POLICY.silenceRms);
    if (activeReference !== activeRendered) return audioTimingReport("FAIL", "CHANNEL_ACTIVITY_MISMATCH");
    if (activeReference) informative.push(channel);
  }
  if (!informative.length) return audioTimingReport("INCOMPLETE", "SILENT_REFERENCE");
  const searchBins = Math.floor(AUDIO_TIMING_POLICY.searchMilliseconds / AUDIO_TIMING_POLICY.binMilliseconds);
  const candidates: Array<{ lag: number; score: number }> = [];
  for (let lag = -searchBins; lag <= searchBins; lag++) {
    const scores = informative.map((channel) => correlationAt(reference[channel]!, rendered[channel]!, lag));
    if (scores.every((score) => score !== null)) candidates.push({ lag, score: Math.min(...scores as number[]) });
  }
  candidates.sort((left, right) => right.score - left.score || Math.abs(left.lag) - Math.abs(right.lag));
  const best = candidates[0];
  if (!best) return audioTimingReport("INCOMPLETE", "UNINFORMATIVE_ENVELOPE");
  const measuredLag = best.lag * AUDIO_TIMING_POLICY.binMilliseconds;
  const report = { ...audioTimingReport("PASS"), lagMilliseconds: measuredLag, correlation: best.score,
    effectiveToleranceMilliseconds,
    lagQuantizationBoundsMilliseconds: { minimum: measuredLag - AUDIO_TIMING_POLICY.lagUncertaintyMilliseconds,
      maximum: measuredLag + AUDIO_TIMING_POLICY.lagUncertaintyMilliseconds } };
  if (best.score < AUDIO_TIMING_POLICY.minimumCorrelation) return { ...report, status: "FAIL", reason: "LOW_ENVELOPE_SIMILARITY" };
  const alternative = candidates.find((candidate) => Math.abs(candidate.lag - best.lag) * AUDIO_TIMING_POLICY.binMilliseconds
    > AUDIO_TIMING_POLICY.peakExclusionMilliseconds);
  if (alternative && best.score - alternative.score < AUDIO_TIMING_POLICY.minimumPeakSeparation) {
    return { ...report, status: "INCOMPLETE", reason: "AMBIGUOUS_ALIGNMENT" };
  }
  if (Math.abs(best.lag) === searchBins) return { ...report, status: "INCOMPLETE", reason: "SEARCH_BOUNDARY" };
  if (Math.abs(measuredLag) > effectiveToleranceMilliseconds) return { ...report, status: "FAIL", reason: "AUDIO_TIMING_OUTSIDE_TOLERANCE" };
  if (Math.abs(measuredLag) + AUDIO_TIMING_POLICY.lagUncertaintyMilliseconds > effectiveToleranceMilliseconds) {
    return { ...report, status: "INCOMPLETE", reason: "TIMING_TOLERANCE_BOUNDARY" };
  }
  return report;
}

export function audioTimingDecodeArguments(inputPath: string, durationSeconds: number): string[] {
  if (!inputPath || inputPath.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(inputPath)
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > AUDIO_TIMING_POLICY.maximumDurationSeconds) {
    throw new Error("AUDIO_TIMING_DECODE_INPUT_INVALID");
  }
  return ["-hide_banner", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", resolve(inputPath),
    "-map", "0:a:0", "-vn", "-t", String(durationSeconds + 0.5), "-af", "aresample=8000:async=1:first_pts=0", "-ac", "2", "-ar", String(AUDIO_TIMING_POLICY.sampleRate),
    "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"];
}

async function hashReference(filePath: string) {
  const file = await stat(filePath);
  if (!file.isFile() || file.size <= 0 || file.size > AUDIO_TIMING_POLICY.maximumFileBytes) throw new Error("AUDIO_TIMING_REFERENCE_INVALID");
  const digest = createHash("sha256"); let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += (chunk as Buffer).length;
    if (bytes > file.size) throw new Error("AUDIO_TIMING_REFERENCE_CHANGED");
    digest.update(chunk as Buffer);
  }
  if (bytes !== file.size) throw new Error("AUDIO_TIMING_REFERENCE_CHANGED");
  return digest.digest("hex");
}

export async function measureExportedAudioTiming(params: {
  ffmpegPath: string; videoPath: string; referencePath: string; referenceMetadataPath: string;
  documentHash: string; durationSeconds: number; frameDurationMilliseconds?: number;
  signal?: AbortSignal;
}, decodePcm?: (filePath: string) => Promise<Buffer>, decodeStream = consumeDecodedPcm): Promise<AudioTimingReport> {
  assertConformanceJobActive(params.signal);
  if (!Number.isFinite(params.durationSeconds) || params.durationSeconds <= 0) {
    return audioTimingReport("MEASUREMENT_FAILED", "AUDIO_TIMING_DECODE_INPUT_INVALID");
  }
  if (params.frameDurationMilliseconds !== undefined && (!Number.isFinite(params.frameDurationMilliseconds) || params.frameDurationMilliseconds <= 0)) {
    return audioTimingReport("MEASUREMENT_FAILED", "AUDIO_TIMING_FRAME_DURATION_INVALID");
  }
  if (params.durationSeconds > AUDIO_TIMING_POLICY.maximumDurationSeconds) return audioTimingReport("INCOMPLETE", "DURATION_LIMIT");
  try {
    const metadataFile = await stat(resolve(params.referenceMetadataPath));
    if (!metadataFile.isFile() || metadataFile.size > 4096) throw new Error("AUDIO_TIMING_METADATA_INVALID");
    const metadata = metadataSchema.parse(JSON.parse(await readFile(resolve(params.referenceMetadataPath), "utf8")));
    if (metadata.documentHash !== params.documentHash) throw new Error("AUDIO_TIMING_REFERENCE_REVISION_MISMATCH");
    const referencePath = resolve(params.referencePath);
    if (await hashReference(referencePath) !== metadata.audioSha256) throw new Error("AUDIO_TIMING_REFERENCE_HASH_MISMATCH");
    const decode = async (filePath: string) => {
      assertConformanceJobActive(params.signal);
      const timing = new StereoPcmEnergyAccumulator(AUDIO_TIMING_POLICY.binMilliseconds);
      const rms = new StereoPcmEnergyAccumulator(AUDIO_RMS_WINDOW_POLICY.windowMilliseconds);
      const consume = (bytes: Uint8Array) => { timing.push(bytes); rms.push(bytes); };
      if (decodePcm) consume(await decodePcm(filePath));
      else await decodeStream({ binary: params.ffmpegPath, arguments: audioTimingDecodeArguments(filePath, params.durationSeconds),
        timeoutMilliseconds: AUDIO_STREAM_LIMITS.decodeTimeoutMilliseconds,
        maximumBytes: Math.ceil((params.durationSeconds + 1) * AUDIO_TIMING_POLICY.sampleRate) * 8, consume, signal: params.signal });
      assertConformanceJobActive(params.signal);
      return { timing: timing.finish().channels, rms: rms.finish() };
    };
    const reference = await decode(referencePath);
    const rendered = await decode(params.videoPath);
    if (await hashReference(referencePath) !== metadata.audioSha256) throw new Error("AUDIO_TIMING_REFERENCE_CHANGED");
    assertConformanceJobActive(params.signal);
    const expectedBins = params.durationSeconds * 1000 / AUDIO_TIMING_POLICY.binMilliseconds;
    if ([reference, rendered].some((envelope) => Math.abs(envelope.timing[0].length - expectedBins)
      * AUDIO_TIMING_POLICY.binMilliseconds > AUDIO_TIMING_POLICY.toleranceMilliseconds)) {
      return { ...audioTimingReport("FAIL", "REFERENCE_OR_RENDER_DURATION_MISMATCH"), referenceSha256: metadata.audioSha256 };
    }
    const rms = compareStereoRmsWindows(reference.rms, rendered.rms);
    const timing = compareStereoEnergyEnvelopes(reference.timing, rendered.timing, params.frameDurationMilliseconds);
    const status = timing.status === "FAIL" || rms.status === "FAIL" ? "FAIL"
      : timing.status === "INCOMPLETE" || rms.status === "INCOMPLETE" ? "INCOMPLETE" : timing.status;
    return { ...timing, status, reason: rms.status === "FAIL" ? rms.reason : timing.reason ?? rms.reason,
      rms, alignment: { status: timing.status, reason: timing.reason }, referenceSha256: metadata.audioSha256 };
  } catch (error) {
    if (error instanceof Error && requiresControlledExecutorIntervention(error.message)) throw error;
    assertConformanceJobActive(params.signal);
    const reason = error instanceof Error && /^AUDIO_TIMING_[A-Z_]+$/.test(error.message) ? error.message : "AUDIO_TIMING_MEASUREMENT_FAILED";
    return audioTimingReport("MEASUREMENT_FAILED", reason);
  }
}
