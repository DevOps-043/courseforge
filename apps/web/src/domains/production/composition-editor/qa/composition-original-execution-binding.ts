import {controlledRenderExecutionContractSchema, controlledRenderExecutionObservationSchema,
  controlledExecutionFilesSchema, controlledComparisonToolsSchema, captureBrowserVersionSchema,
  evaluateControlledRenderExecution, CONTROLLED_RENDER_EXECUTION_POLICY} from "../composition-render-execution-contract";
import {z} from "zod";
import {buildControlledExecutionObservation} from "./composition-controlled-execution-observation";

const fileObservationsSchema = z.object({scope: z.literal("DECLARED_TREES_NOT_OS_IMAGE_OR_DYNAMIC_DEPENDENCY_PROOF"),
  files: controlledExecutionFilesSchema, comparisonTools: controlledComparisonToolsSchema.optional()}).strict();

/** File/CDP plus successful SDR results when required; never copy policies from expectations. */
export function buildOriginalExecutionObservation(input: {expected: unknown; documentHash: string; videoSha256: string;
  fileObservations: unknown; browserBefore: unknown; browserAfter: unknown; sdrEncoding?: unknown; sdrMux?: unknown; sdrSilentAssembly?: unknown}) {
  const expected = controlledRenderExecutionContractSchema.parse(input.expected);
  if ((expected.sdrConversionPolicy && input.sdrEncoding === undefined) || (expected.sdrAudioMuxPolicy && input.sdrMux === undefined))
    throw new Error("CONTROLLED_RENDER_ORIGINAL_EXECUTION_SDR_RESULTS_REQUIRED");
  const measured = fileObservationsSchema.parse(input.fileObservations);
  const observation = controlledRenderExecutionObservationSchema.parse({policy: CONTROLLED_RENDER_EXECUTION_POLICY,
    documentHash: input.documentHash, videoSha256: input.videoSha256, files: measured.files,
    ...(measured.comparisonTools ? {comparisonTools: measured.comparisonTools} : {}),
    browserBefore: captureBrowserVersionSchema.parse(input.browserBefore), browserAfter: captureBrowserVersionSchema.parse(input.browserAfter)});
  let bound;
  try {bound = buildControlledExecutionObservation({expected, observation, sdrEncoding: input.sdrEncoding, sdrMux: input.sdrMux,
    sdrSilentAssembly: input.sdrSilentAssembly});}
  catch (error) {
    if (error instanceof Error && error.message === "CONTROLLED_RENDER_OBSERVATION_EXECUTION_MISMATCH")
      throw new Error("CONTROLLED_RENDER_ORIGINAL_EXECUTION_BINDING_INVALID");
    throw error;
  }
  return bindOriginalExecutionObservation({expected, documentHash: input.documentHash, videoSha256: input.videoSha256, observation: bound});
}

export function bindOriginalExecutionObservation(input: {expected: unknown; documentHash: string; videoSha256: string;
  observation: unknown; supplied?: unknown}) {
  const expected = controlledRenderExecutionContractSchema.parse(input.expected);
  const observation = controlledRenderExecutionObservationSchema.parse(input.observation);
  if (evaluateControlledRenderExecution({...input, expected, observation}).status !== "MATCH")
    throw new Error("CONTROLLED_RENDER_ORIGINAL_EXECUTION_BINDING_INVALID");
  if (input.supplied !== undefined && JSON.stringify(controlledRenderExecutionObservationSchema.parse(input.supplied)) !== JSON.stringify(observation))
    throw new Error("CONTROLLED_RENDER_ORIGINAL_EXECUTION_CONFLICT");
  return observation;
}
