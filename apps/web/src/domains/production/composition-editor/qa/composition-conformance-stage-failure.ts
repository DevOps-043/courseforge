import { z, ZodError } from "zod";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";

export const conformanceExecutionStageSchema = z.enum([
  "REMOTE_SNAPSHOT", "RENDER_EVIDENCE_ADMISSION", "PREVIEW_REFERENCE", "AUDIO_REFERENCE", "RENDER_COMPARISON",
  "EVENT_COMPARISON", "REMOTE_RECHECK", "REPORT_VALIDATION", "RESOURCE_CLEANUP",
  "SOURCE_MATERIALIZATION", "PREVIEW_CAPTURE", "EVIDENCE_PERSISTENCE",
]);
export type ConformanceExecutionStage = z.infer<typeof conformanceExecutionStageSchema>;
const permanentCode = /(?:MISMATCH|INVALID|OVERWRITTEN|UNSUPPORTED|LEGACY|CLIPPING|LIMIT|EXCEEDED)/;

/** Records the failed orchestration boundary, never an inferred decoder/evaluator root cause. */
export class ConformanceStageFailure extends Error {
  readonly scope = "FAILED_EXECUTION_STAGE_NOT_ROOT_CAUSALITY";
  readonly stage: ConformanceExecutionStage;
  readonly retryable: boolean;
  readonly cleanupFailed: boolean;
  readonly recoveryRequired: boolean;
  constructor(stage: ConformanceExecutionStage, error: unknown, cleanupFailed = false) {
    const parsedStage = conformanceExecutionStageSchema.parse(stage);
    const message = error instanceof ZodError
      ? error.issues.find((issue) => /^CONFORMANCE_JOB_[A-Z_]{1,96}$/.test(issue.message))?.message ?? ""
      : error instanceof Error ? error.message : "";
    // Only application-owned canonical job codes survive; no arbitrary message or cause is retained.
    const safeCode = /^CONFORMANCE_JOB_[A-Z_]{1,96}$/.test(message) ? message : null;
    const canonicalCode = /^(?:CONFORMANCE_|VIDEO_INTEGRITY_|AUDIO_|COMPOSITION_|RENDER_AUTHORITY_|RENDER_SUPERVISOR_)[A-Z0-9_]{1,128}$/.test(message);
    const recoveryRequired = requiresConformanceExecutionRecovery(error);
    super(recoveryRequired ? `CONFORMANCE_JOB_${parsedStage}_RECOVERY_REQUIRED` : safeCode ?? `CONFORMANCE_JOB_${parsedStage}_FAILED`);
    this.name = "ConformanceStageFailure";
    this.stage = parsedStage;
    this.recoveryRequired = recoveryRequired;
    this.retryable = !recoveryRequired && (error instanceof ConformanceStageFailure ? error.retryable
      : !(error instanceof ZodError || canonicalCode && permanentCode.test(message)));
    this.cleanupFailed = cleanupFailed;
    Object.freeze(this);
  }
  get errorCode() {
    return `CONFORMANCE_JOB_${this.stage}${this.cleanupFailed ? "_WITH_CLEANUP" : ""}_${this.recoveryRequired ? "RECOVERY_REQUIRED" : this.retryable ? "FAILED" : "REJECTED"}`;
  }
}

/** Unconfirmed ownership survives sanitized stage boundaries; never retry or erase live inputs. */
export function requiresConformanceExecutionRecovery(error: unknown): boolean {
  return error instanceof ConformanceStageFailure ? error.recoveryRequired
    : error instanceof Error && (requiresControlledExecutorIntervention(error.message)
      || /^CONFORMANCE_JOB_[A-Z_]+_RECOVERY_REQUIRED$/.test(error.message));
}

export function wrapConformanceStageFailure(stage: ConformanceExecutionStage, error: unknown) {
  return error instanceof ConformanceStageFailure ? error : new ConformanceStageFailure(stage, error);
}

export function recordConformanceCleanupFailure(primary?: ConformanceStageFailure) {
  return primary ? new ConformanceStageFailure(primary.stage, primary, true)
    : new ConformanceStageFailure("RESOURCE_CLEANUP", new Error("CONFORMANCE_JOB_CLEANUP_FAILED"));
}
