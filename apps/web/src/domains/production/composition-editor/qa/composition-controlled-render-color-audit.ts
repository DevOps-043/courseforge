import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { auditColorChartPng, COLOR_CHART_AUDIT_POLICY, hashColorChartAuditPlan, type ColorChartAuditPlan } from "./composition-color-chart-audit";
import { assertConformanceFileUnchanged, pinConformanceFile } from "./composition-conformance-file-integrity";
import {SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";

const executeFile = promisify(execFile);
type FrameDecoder = (binary: string, args: string[], options: {timeout: number; maxBuffer: number;
  windowsHide: boolean; encoding: "buffer"; signal?: AbortSignal}) => Promise<{stdout: Buffer}>;

/** Authored RGB sanity check of three decoded MP4 frames; not preview parity or general SDR conversion. */
export async function auditControlledRenderColor(input: {
  videoPath: string; videoSha256: string; ffmpegPath: string; ffmpegSha256: string;
  plan: ColorChartAuditPlan; fps: 24 | 25 | 30 | 60; durationSeconds: number; signal?: AbortSignal;
  sdrConversionPolicy?: typeof SDR_FRAME_CONVERSION_POLICY.id;
}, decode: FrameDecoder = executeFile) {
  if (input.sdrConversionPolicy !== undefined && input.sdrConversionPolicy !== SDR_FRAME_CONVERSION_POLICY.id
    || !/^[a-f0-9]{64}$/.test(input.videoSha256) || !/^[a-f0-9]{64}$/.test(input.ffmpegSha256)
    || ![24, 25, 30, 60].includes(input.fps) || !Number.isFinite(input.durationSeconds)
    || input.durationSeconds <= 0 || input.durationSeconds > 30
    || !Number.isInteger(input.durationSeconds * input.fps)) throw new Error("CONTROLLED_RENDER_COLOR_ARGUMENTS_INVALID");
  const assertActive = () => {if (input.signal?.aborted) throw new Error("CONTROLLED_RENDER_ABORTED");};
  assertActive();
  const planSha256 = hashColorChartAuditPlan(input.plan);
  const maximumVideoBytes = 512 * 1024 * 1024, maximumToolBytes = 1024 ** 3;
  const [video, decoder] = await Promise.all([pinConformanceFile(input.videoPath, maximumVideoBytes),
    pinConformanceFile(input.ffmpegPath, maximumToolBytes)]);
  if (video.sha256 !== input.videoSha256 || decoder.sha256 !== input.ffmpegSha256)
    throw new Error("CONTROLLED_RENDER_COLOR_HASH_MISMATCH");
  const indexes = [...new Set([0, Math.floor(input.durationSeconds * input.fps / 2), input.durationSeconds * input.fps - 1])];
  const frames: Array<{frameIndex: number; audit: Awaited<ReturnType<typeof auditColorChartPng>>}> = [];
  for (const frameIndex of indexes) {
    assertActive();
    let png: Buffer;
    try {
      const result = await decode(input.ffmpegPath, ["-hide_banner", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file,pipe",
        "-ss", String(frameIndex / input.fps), "-i", input.videoPath, "-map", "0:v:0", "-frames:v", "1",
        ...(input.sdrConversionPolicy ? ["-vf", SDR_FRAME_CONVERSION_POLICY.compareFilter] : []),
        "-f", "image2pipe", "-vcodec", "png", "-"],
      {timeout: 30_000, maxBuffer: COLOR_CHART_AUDIT_POLICY.maximumPngBytes, windowsHide: true, encoding: "buffer", signal: input.signal});
      png = result.stdout;
    } catch {
      assertActive(); throw new Error("CONTROLLED_RENDER_COLOR_DECODE_FAILED");
    }
    const audit = await auditColorChartPng({plan: input.plan, png, documentHash: input.plan.documentHash});
    frames.push({frameIndex, audit});
  }
  assertActive();
  await Promise.all([assertConformanceFileUnchanged(input.videoPath, video, maximumVideoBytes),
    assertConformanceFileUnchanged(input.ffmpegPath, decoder, maximumToolBytes)]);
  if (hashColorChartAuditPlan(input.plan) !== planSha256) throw new Error("CONTROLLED_RENDER_COLOR_PLAN_CHANGED");
  return {scope: "DECODED_LOCAL_MP4_NEUTRAL_CHART_NOT_PREVIEW_PARITY_OR_SDR_ATTESTATION" as const,
    ...(input.sdrConversionPolicy ? {sdrConversionPolicy: input.sdrConversionPolicy} : {}),
    videoSha256: video.sha256, decoderSha256: decoder.sha256, planSha256, frames,
    status: frames.every((frame) => frame.audit.status === "PASS") ? "PASS" as const : "FAIL" as const};
}
