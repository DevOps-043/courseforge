import { compositionConformanceContractSchema, type CompositionConformanceReport } from "../composition-preview-render-conformance";
import { selectDeckTextCheckpointClips } from "../composition-deck-text-plan";
import { rendererFontUsagePendingSchema } from "../composition-font-usage-contract";
import { exportedColorTagReportSchema } from "../composition-color-tag-policy";
import { COMPOSITION_SSIM_POLICY } from "../composition-visual-metrics-policy";
import {controlledRenderExecutionReportSchema} from "../composition-render-execution-contract";
import {bindControlledSeekRepeatability} from "./composition-controlled-seek-binding";
import {assertControlledFontWitnessMatchesContract} from "./composition-controlled-font-witness";

/** Independent final-worker check: a comparison report cannot shed frozen snapshot obligations. */
export function assertConformanceReportMatchesContract(contractInput: unknown, visual: CompositionConformanceReport | undefined,
  binding?: {videoSha256: string}) {
  const contract = compositionConformanceContractSchema.parse(contractInput);
  if (contract.schemaVersion === 1 || contract.schemaVersion === 2) return contract;
  if (!visual || visual.requiredCheckpointCount !== contract.checkpoints.length || !visual.ssim
    || visual.ssim.policy !== COMPOSITION_SSIM_POLICY.id
    || visual.ssim.checkedCheckpointCount > contract.checkpoints.length
    || visual.ssim.minimumRequired !== contract.visualMetrics.minimumSsim)
    throw new Error("CONFORMANCE_JOB_VISUAL_CONTRACT_INVALID");
  if (visual.status === "PASS" && (visual.checkedCheckpointCount !== contract.checkpoints.length
    || visual.ssim.checkedCheckpointCount !== contract.checkpoints.length
    || visual.ssim.minimumObserved === null || !Number.isFinite(visual.ssim.minimumObserved)
    || visual.ssim.minimumObserved < contract.visualMetrics.minimumSsim || visual.ssim.minimumObserved > 1))
    throw new Error("CONFORMANCE_JOB_VISUAL_PASS_INVALID");
  if (contract.schemaVersion !== 4) return contract;
  const seek = bindControlledSeekRepeatability(contract, visual.seekRepeatability);
  if (contract.renderExecution?.seekRepeatabilityPolicy && !seek
    && !visual.incompletenessReasons?.includes("RENDER_SEEK_REPEATABILITY_UNAVAILABLE"))
    throw new Error("CONFORMANCE_JOB_RENDER_SEEK_REQUIRED");
  if (contract.renderExecution) {
    const execution = controlledRenderExecutionReportSchema.safeParse(visual.renderExecution);
    if (!execution.success || execution.data.documentHash !== contract.documentHash
      || !binding || execution.data.videoSha256 !== binding.videoSha256)
      throw new Error("CONFORMANCE_JOB_RENDER_EXECUTION_BINDING_INVALID");
    if (visual.status === "PASS" || !visual.incompletenessReasons?.includes("RENDER_EXECUTION_ATTESTATION_PENDING"))
      throw new Error("CONFORMANCE_JOB_RENDER_EXECUTION_ATTESTATION_PENDING");
    if (execution.data.status === "MISMATCH" && visual.status !== "FAIL")
      throw new Error("CONFORMANCE_JOB_RENDER_EXECUTION_FAILURE_INVALID");
    if (!contract.renderExecution.comparisonTools
      && execution.data.mismatches.some(role => role === "PIXEL_DECODER" || role === "PROBE"))
      throw new Error("CONFORMANCE_JOB_COMPARISON_TOOLS_UNAUTHORIZED");
    if (!contract.renderExecution.sdrConversionPolicy && execution.data.mismatches.includes("SDR_CONVERSION"))
      throw new Error("CONFORMANCE_JOB_SDR_CONVERSION_UNAUTHORIZED");
    if (!contract.renderExecution.sdrAudioMuxPolicy && execution.data.mismatches.includes("SDR_AUDIO_MUX"))
      throw new Error("CONFORMANCE_JOB_SDR_AUDIO_MUX_UNAUTHORIZED");
  } else if (visual.renderExecution) throw new Error("CONFORMANCE_JOB_RENDER_EXECUTION_UNAUTHORIZED");
  const native = visual.textParity;
  const expectedNativeRegions = contract.textParity.checkpoints.reduce((count, checkpoint) => count + checkpoint.expectedTexts.length, 0);
  if (!native || native.requiredCheckpointCount !== contract.checkpoints.length || native.expectedRegionCount !== expectedNativeRegions
    || native.policy !== contract.textParity.policy || native.scope !== contract.textParity.scope)
    throw new Error("CONFORMANCE_JOB_NATIVE_TEXT_CONTRACT_INVALID");
  if (visual.status === "PASS" && (native.status !== "PASS" || native.checkedCheckpointCount !== contract.checkpoints.length
    || native.checkedRegionCount !== expectedNativeRegions))
    throw new Error("CONFORMANCE_JOB_NATIVE_TEXT_PASS_INVALID");
  if (contract.deckTextPlan) {
    const deck = visual.deckText;
    const expectedDeckRegions = contract.checkpoints.reduce((count, checkpoint) => count
      + selectDeckTextCheckpointClips(contract.deckTextPlan!, checkpoint.timeSeconds)
        .reduce((clipCount, clip) => clipCount + clip.entries.length, 0), 0);
    if (!deck || deck.policy !== contract.deckTextPlan.policy
      || deck.scope !== "DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION"
      || deck.requiredCheckpointCount !== contract.checkpoints.length || deck.expectedRegionCount !== expectedDeckRegions)
      throw new Error("CONFORMANCE_JOB_DECK_TEXT_CONTRACT_INVALID");
    // The current regional witness is not a renderer/font attestation. Never promote its PASS to global PASS.
    if (contract.deckTextPlan.clips.length && (visual.status === "PASS"
      || !visual.incompletenessReasons?.includes("DECK_TEXT_EVIDENCE_INCOMPLETE")))
      throw new Error("CONFORMANCE_JOB_DECK_ATTESTATION_PENDING_INVALID");
  } else if (visual.deckText) throw new Error("CONFORMANCE_JOB_DECK_TEXT_UNAUTHORIZED_INVALID");
  if (contract.fontUsageContract?.bindings.length) {
    const usage = rendererFontUsagePendingSchema.safeParse(visual.fontUsage);
    if (!usage.success || usage.data.policy !== contract.fontUsageContract.policy
      || usage.data.manifestSha256 !== contract.fontUsageContract.manifestSha256
      || usage.data.requiredBindingCount !== contract.fontUsageContract.bindings.length)
      throw new Error("CONFORMANCE_JOB_RENDERER_FONT_USAGE_CONTRACT_INVALID");
    if (usage.data.observedWitness) {
      if (!binding) throw new Error("CONFORMANCE_JOB_RENDER_FONT_VIDEO_REQUIRED");
      assertControlledFontWitnessMatchesContract(contract, usage.data.observedWitness, binding.videoSha256);
    }
    if (visual.status === "PASS" || !visual.incompletenessReasons?.includes("RENDERER_FONT_USAGE_UNAVAILABLE"))
      throw new Error("CONFORMANCE_JOB_RENDERER_FONT_ATTESTATION_PENDING_INVALID");
  } else if (visual.fontUsage) throw new Error("CONFORMANCE_JOB_RENDERER_FONT_USAGE_UNAUTHORIZED_INVALID");
  if (contract.colorTagPolicy) {
    const tags = exportedColorTagReportSchema.safeParse(visual.colorTags);
    if (!tags.success || tags.data.policy !== contract.colorTagPolicy)
      throw new Error("CONFORMANCE_JOB_COLOR_TAG_CONTRACT_INVALID");
    if (visual.status === "PASS" || !visual.incompletenessReasons?.includes("SDR_PIXEL_CONVERSION_UNATTESTED"))
      throw new Error("CONFORMANCE_JOB_SDR_CONVERSION_ATTESTATION_PENDING_INVALID");
    if (tags.data.status === "INCOMPLETE" && !visual.incompletenessReasons?.includes("COLOR_TAGS_INCOMPLETE"))
      throw new Error("CONFORMANCE_JOB_COLOR_TAG_INCOMPLETE_INVALID");
    if (tags.data.status === "FAIL" && visual.status !== "FAIL")
      throw new Error("CONFORMANCE_JOB_COLOR_TAG_FAILURE_INVALID");
  }
  return contract;
}
