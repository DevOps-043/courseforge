import {isAbsolute} from "node:path";
import {CONTROLLED_COMPARISON_TOOLS_POLICY, controlledComparisonToolsSchema,
  type ControlledComparisonTools} from "../composition-render-execution-contract";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

const MAXIMUM_TOOL_BYTES = 1024 ** 3;

/** Local pre/post file checks only: not an immutable executable image or process attestation. */
export async function pinComparisonTools(input: {pixelDecoderPath: string; probePath: string;
  expected?: ControlledComparisonTools; signal?: AbortSignal}) {
  assertConformanceJobActive(input.signal);
  if (!isAbsolute(input.pixelDecoderPath) || !isAbsolute(input.probePath))
    throw new Error("CONFORMANCE_COMPARISON_TOOL_PATH_INVALID");
  const expected = input.expected === undefined ? undefined : controlledComparisonToolsSchema.parse(input.expected);
  const paths = {pixelDecoder: input.pixelDecoderPath, probe: input.probePath};
  const pixelDecoder = await pinConformanceFile(paths.pixelDecoder, MAXIMUM_TOOL_BYTES);
  assertConformanceJobActive(input.signal);
  const pins = {pixelDecoder, probe: await pinConformanceFile(paths.probe, MAXIMUM_TOOL_BYTES)};
  assertConformanceJobActive(input.signal);
  const observed = controlledComparisonToolsSchema.parse({policy: CONTROLLED_COMPARISON_TOOLS_POLICY,
    pixelDecoder: {sha256: pins.pixelDecoder.sha256, sizeBytes: pins.pixelDecoder.sizeBytes},
    probe: {sha256: pins.probe.sha256, sizeBytes: pins.probe.sizeBytes}});
  for (const role of ["pixelDecoder", "probe"] as const) {
    if (expected && (expected[role].sha256 !== observed[role].sha256 || expected[role].sizeBytes !== observed[role].sizeBytes))
      throw new Error(role === "pixelDecoder" ? "CONFORMANCE_PIXEL_DECODER_IDENTITY_MISMATCH" : "CONFORMANCE_PROBE_IDENTITY_MISMATCH");
  }
  return {observed, async assertUnchanged() {
    assertConformanceJobActive(input.signal);
    for (const role of ["pixelDecoder", "probe"] as const) {
      await assertConformanceFileUnchanged(paths[role], pins[role], MAXIMUM_TOOL_BYTES);
      assertConformanceJobActive(input.signal);
    }
  }};
}
