import type {ComparisonProcessPorts} from "./composition-comparison-process-ports";
import {executeConformanceJob} from "./composition-conformance-job-execution";
import {CompositionConformanceRenderReservationService, type ConformanceRenderReservation} from "./composition-conformance-render-reservation.service";
import type {ConformanceJobClaim} from "./composition-conformance-job-worker";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";

type ExecutionInput = Parameters<typeof executeConformanceJob>[0];

/** Fixed host composition; no dynamic module/CLI script, latest execution or legacy fallback.
 * Port resolution must not launch unowned processes. Ownership/isolation stays with the supplied host. */
export function createReservedConformanceWorkerHost(input: Pick<ExecutionInput,
  "supabase" | "supabaseUrl" | "ffmpegPath" | "allowLongAudio" | "capturePlaybackAudio" | "colorTagPolicyId" | "enableSilentDurableReports">
  & {integrity: Parameters<typeof executeConformanceJob>[1];
    resolveProcessPorts: (reservation: ConformanceRenderReservation, signal: AbortSignal) => ComparisonProcessPorts | Promise<ComparisonProcessPorts>;
    evidence?: Parameters<typeof executeConformanceJob>[2]}) {
  if (typeof input.resolveProcessPorts !== "function") throw new Error("CONFORMANCE_JOB_DURABLE_PROCESS_PORTS_REQUIRED_INVALID");
  const reservations = new CompositionConformanceRenderReservationService(input.supabase);
  return (claim: ConformanceJobClaim, signal: AbortSignal) => executeConformanceJob({claim, signal,
    supabase: input.supabase, supabaseUrl: input.supabaseUrl, ffmpegPath: input.ffmpegPath,
    allowLongAudio: input.allowLongAudio, capturePlaybackAudio: input.capturePlaybackAudio,
    colorTagPolicyId: input.colorTagPolicyId, enableSilentDurableReports: input.enableSilentDurableReports,
    resolveRenderReservation: async (ownedClaim, budgetSignal) => {
      const {reservation, sha256} = await reservations.read(ownedClaim, budgetSignal);
      assertConformanceJobActive(budgetSignal);
      const processPorts = await input.resolveProcessPorts(structuredClone(reservation), budgetSignal);
      assertConformanceJobActive(budgetSignal);
      return {controlledRenderEvidence: {scope: reservation.scope, artifacts: reservation.artifacts},
        referenceSelection: reservation.referenceSelection, processPorts,
        reservationEvidence: {policy: reservation.policy, sha256, executionId: reservation.scope.executionId,
          supervisorReceiptSha256: reservation.supervisorReceiptSha256}};
    },
  }, input.integrity, input.evidence);
}
