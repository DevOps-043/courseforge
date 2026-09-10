import { z } from "zod";

export const scormProcessRequestSchema = z.object({
  importId: z.string().uuid(),
}).strict();

export const SCORM_IMPORT_STATUS = {
  analyzed: "SCORM_ANALYZED",
  completed: "COMPLETED",
  failed: "FAILED",
  transforming: "SCORM_TRANSFORMING",
  uploaded: "SCORM_UPLOADED",
} as const;

export const SCORM_PROCESSING_STEP = {
  queued: "TRANSFORM_QUEUED",
  running: "TRANSFORM_RUNNING",
} as const;

export type ScormImportStatusKind = "ready" | "active" | "completed" | "failed" | "invalid";

export function classifyScormImportStatus(status: unknown): ScormImportStatusKind {
  if (status === SCORM_IMPORT_STATUS.analyzed || status === "ANALYZED") return "ready";
  if (status === SCORM_IMPORT_STATUS.transforming || status === "TRANSFORMING") return "active";
  if (status === SCORM_IMPORT_STATUS.completed) return "completed";
  if (status === SCORM_IMPORT_STATUS.failed) return "failed";
  return "invalid";
}

export function isQueuedScormTransformation(status: unknown, processingStep: unknown): boolean {
  return classifyScormImportStatus(status) === "active"
    && processingStep === SCORM_PROCESSING_STEP.queued;
}
