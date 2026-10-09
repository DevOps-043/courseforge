import {z} from "zod";
import {controlledRenderExecutionContractSchema, controlledRenderExecutionObservationSchema,
  evaluateControlledRenderExecution} from "../composition-render-execution-contract";
import {SDR_AUDIO_MUX_POLICY, SDR_SILENT_ASSEMBLY_POLICY, SDR_FRAME_CONVERSION_POLICY} from "../composition-sdr-conversion-policy";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const encoderBindingSchema = z.object({policy: z.object({id: z.literal(SDR_FRAME_CONVERSION_POLICY.id)}).passthrough(),
  encoderSha256: hash, probeSha256: hash, output: z.object({sha256: hash}).passthrough()}).passthrough();
const muxBindingSchema = z.object({policy: z.literal(SDR_AUDIO_MUX_POLICY),
  scope: z.literal("LOCAL_PROBED_VIDEO_PAYLOADS_NOT_SYNC_OR_RENDER_ATTESTATION"),
  silentVideoSha256: hash, videoSha256: hash, probeSha256: hash,
  videoPayloadSha256: hash, videoTimingSha256: hash}).passthrough();
const silentAssemblyBindingSchema = muxBindingSchema.extend({policy: z.literal(SDR_SILENT_ASSEMBLY_POLICY),
  scope: z.literal("LOCAL_PROBED_SILENT_VIDEO_COPY_NOT_RENDER_ATTESTATION")});

/** Assemble local observations from successful encoder/mux results; never grant provenance or PASS. */
export function buildControlledExecutionObservation(input: {expected: unknown; observation: unknown;
  sdrEncoding?: unknown; sdrMux?: unknown; sdrSilentAssembly?: unknown}) {
  const expected = controlledRenderExecutionContractSchema.parse(input.expected);
  const observation = controlledRenderExecutionObservationSchema.parse(input.observation);
  if (observation.sdrConversionPolicy || observation.sdrAudioMuxPolicy)
    throw new Error("CONTROLLED_RENDER_OBSERVATION_POLICY_PREDECLARED");
  if (expected.sdrConversionPolicy) {
    const encoding = encoderBindingSchema.safeParse(input.sdrEncoding);
    if (!encoding.success || encoding.data.encoderSha256 !== expected.files.encoder.sha256
      || encoding.data.probeSha256 !== expected.comparisonTools?.probe.sha256)
      throw new Error("CONTROLLED_RENDER_OBSERVATION_SDR_BINDING_INVALID");
    observation.sdrConversionPolicy = encoding.data.policy.id;
    if (expected.sdrAudioMuxPolicy) {
      if (input.sdrSilentAssembly !== undefined) throw new Error("CONTROLLED_RENDER_OBSERVATION_SILENT_ASSEMBLY_UNAUTHORIZED");
      const mux = muxBindingSchema.safeParse(input.sdrMux);
      if (!mux.success || mux.data.silentVideoSha256 !== encoding.data.output.sha256
        || mux.data.videoSha256 !== observation.videoSha256
        || mux.data.probeSha256 !== encoding.data.probeSha256)
        throw new Error("CONTROLLED_RENDER_OBSERVATION_MUX_BINDING_INVALID");
      observation.sdrAudioMuxPolicy = mux.data.policy;
    } else {
      if (input.sdrMux !== undefined) throw new Error("CONTROLLED_RENDER_OBSERVATION_SDR_OUTPUT_INVALID");
      if (input.sdrSilentAssembly !== undefined) {
        const assembly = silentAssemblyBindingSchema.safeParse(input.sdrSilentAssembly);
        if (!assembly.success || assembly.data.silentVideoSha256 !== encoding.data.output.sha256
          || assembly.data.videoSha256 !== observation.videoSha256 || assembly.data.probeSha256 !== encoding.data.probeSha256)
          throw new Error("CONTROLLED_RENDER_OBSERVATION_SILENT_ASSEMBLY_BINDING_INVALID");
      } else if (encoding.data.output.sha256 !== observation.videoSha256)
        throw new Error("CONTROLLED_RENDER_OBSERVATION_SDR_OUTPUT_INVALID");
    }
  } else if (input.sdrEncoding !== undefined || input.sdrMux !== undefined || input.sdrSilentAssembly !== undefined)
    throw new Error("CONTROLLED_RENDER_OBSERVATION_SDR_UNAUTHORIZED");
  const report = evaluateControlledRenderExecution({expected, observation,
    documentHash: observation.documentHash, videoSha256: observation.videoSha256});
  if (report.status !== "MATCH") throw new Error("CONTROLLED_RENDER_OBSERVATION_EXECUTION_MISMATCH");
  return observation;
}
