import {z} from "zod";
import {CONTROLLED_SEEK_POLICY} from "./composition-render-seek-policy";
import {SDR_FRAME_CONVERSION_POLICY, SDR_AUDIO_MUX_POLICY} from "./composition-sdr-conversion-policy";

export const CONTROLLED_RENDER_EXECUTION_POLICY = "CONTROLLED_FILES_AND_BROWSER_SESSION_V1";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const identityText = z.string().min(1).max(512).regex(/^[\x20-\x7e]+$/);
export const captureBrowserVersionSchema = z.object({protocolVersion: identityText, product: identityText,
  revision: identityText, userAgent: identityText, jsVersion: identityText}).strict();
const file = z.object({sha256: hash, sizeBytes: z.number().int().positive().max(1024 ** 3)}).strict();
export const controlledExecutionFilesSchema = z.object({node: file, producer: file, engine: file,
  runtime: file, browser: file, encoder: file, decoder: file}).strict();
// Legacy files.decoder identifies the SDK probe. Never reinterpret it as the pixel decoder.
export const CONTROLLED_COMPARISON_TOOLS_POLICY = "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1";
export const controlledComparisonToolsSchema = z.object({policy: z.literal(CONTROLLED_COMPARISON_TOOLS_POLICY),
  pixelDecoder: file, probe: file}).strict();
export type ControlledComparisonTools = z.infer<typeof controlledComparisonToolsSchema>;

/** Isomorphic contract, with no filesystem paths or server-side hashing dependency. */
export const controlledRenderExecutionContractSchema = z.object({policy: z.literal(CONTROLLED_RENDER_EXECUTION_POLICY),
  backend: z.literal("CONTROLLED"), sdkVersion: z.literal("0.7.106"), files: controlledExecutionFilesSchema,
  expectedBrowser: captureBrowserVersionSchema,
  comparisonTools: controlledComparisonToolsSchema.optional(),
  sdrConversionPolicy: z.literal(SDR_FRAME_CONVERSION_POLICY.id).optional(),
  sdrAudioMuxPolicy: z.literal(SDR_AUDIO_MUX_POLICY).optional(),
  seekRepeatabilityPolicy: z.literal(CONTROLLED_SEEK_POLICY).optional(),
}).strict().superRefine((contract, context) => {
  if (contract.sdrConversionPolicy && !contract.comparisonTools)
    context.addIssue({code: "custom", message: "CONFORMANCE_SDR_COMPARISON_TOOLS_REQUIRED"});
  if (contract.sdrAudioMuxPolicy && !contract.sdrConversionPolicy)
    context.addIssue({code: "custom", message: "CONFORMANCE_SDR_CONVERSION_REQUIRED"});
});
export type ControlledRenderExecutionContract = z.infer<typeof controlledRenderExecutionContractSchema>;

export const controlledRenderExecutionObservationSchema = z.object({policy: z.literal(CONTROLLED_RENDER_EXECUTION_POLICY),
  documentHash: hash, videoSha256: hash, files: controlledExecutionFilesSchema,
  browserBefore: captureBrowserVersionSchema, browserAfter: captureBrowserVersionSchema,
  comparisonTools: controlledComparisonToolsSchema.optional(),
  sdrConversionPolicy: z.literal(SDR_FRAME_CONVERSION_POLICY.id).optional(),
  sdrAudioMuxPolicy: z.literal(SDR_AUDIO_MUX_POLICY).optional(),
}).strict();

/** MATCH is only a file/session match. It never means isolated execution or authorized provenance. */
export const controlledRenderExecutionReportSchema = z.object({policy: z.literal(CONTROLLED_RENDER_EXECUTION_POLICY),
  scope: z.literal("FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION"),
  status: z.enum(["MATCH", "MISMATCH", "MISSING"]), documentHash: hash, videoSha256: hash,
  reason: z.literal("RENDER_EXECUTION_ATTESTATION_PENDING"),
  mismatches: z.array(z.enum(["DOCUMENT", "VIDEO", "NODE", "PRODUCER", "ENGINE", "RUNTIME", "BROWSER_FILE", "ENCODER", "DECODER", "BROWSER_SESSION", "PIXEL_DECODER", "PROBE", "SDR_CONVERSION", "SDR_AUDIO_MUX"])).max(14),
}).strict().superRefine((report, context) => {
  if (new Set(report.mismatches).size !== report.mismatches.length
    || report.status === "MISMATCH" && report.mismatches.length === 0
    || report.status !== "MISMATCH" && report.mismatches.length !== 0)
    context.addIssue({code: "custom", message: "CONFORMANCE_RENDER_EXECUTION_REPORT_INVALID"});
});
export type ControlledRenderExecutionReport = z.infer<typeof controlledRenderExecutionReportSchema>;

export function evaluateControlledRenderExecution(input: {expected: ControlledRenderExecutionContract;
  documentHash: string; videoSha256: string; observation?: unknown}): ControlledRenderExecutionReport {
  const expected = controlledRenderExecutionContractSchema.parse(input.expected);
  const binding = z.object({documentHash: hash, videoSha256: hash}).parse(input);
  const base = {policy: expected.policy, scope: "FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION" as const,
    ...binding, reason: "RENDER_EXECUTION_ATTESTATION_PENDING" as const};
  if (input.observation === undefined) return {...base, status: "MISSING", mismatches: []};
  const observation = controlledRenderExecutionObservationSchema.parse(input.observation);
  const mismatches: ControlledRenderExecutionReport["mismatches"] = [];
  if (observation.documentHash !== binding.documentHash) mismatches.push("DOCUMENT");
  if (observation.videoSha256 !== binding.videoSha256) mismatches.push("VIDEO");
  const metrics = {node: "NODE", producer: "PRODUCER", engine: "ENGINE", runtime: "RUNTIME", browser: "BROWSER_FILE",
    encoder: "ENCODER", decoder: "DECODER"} as const;
  for (const role of Object.keys(metrics) as Array<keyof typeof metrics>) {
    if (expected.files[role].sha256 !== observation.files[role].sha256
      || expected.files[role].sizeBytes !== observation.files[role].sizeBytes) mismatches.push(metrics[role]);
  }
  if (expected.comparisonTools || observation.comparisonTools) {
    for (const [role, mismatch] of [["pixelDecoder", "PIXEL_DECODER"], ["probe", "PROBE"]] as const) {
      const required = expected.comparisonTools?.[role], observed = observation.comparisonTools?.[role];
      if (!required || !observed || required.sha256 !== observed.sha256 || required.sizeBytes !== observed.sizeBytes)
        mismatches.push(mismatch);
    }
  }
  if (JSON.stringify(expected.expectedBrowser) !== JSON.stringify(observation.browserBefore)
    || JSON.stringify(expected.expectedBrowser) !== JSON.stringify(observation.browserAfter)) mismatches.push("BROWSER_SESSION");
  if (expected.sdrConversionPolicy !== observation.sdrConversionPolicy) mismatches.push("SDR_CONVERSION");
  if (expected.sdrAudioMuxPolicy !== observation.sdrAudioMuxPolicy) mismatches.push("SDR_AUDIO_MUX");
  return {...base, status: mismatches.length ? "MISMATCH" : "MATCH", mismatches};
}
