import { z } from "zod";

export const scormProcessRequestSchema = z.object({
  importId: z.string().uuid(),
}).strict();

export const SCORM_IMPORT_STATUS = {
  analyzed: "SCORM_ANALYZED",
  completed: "COMPLETED",
  failed: "FAILED",
  parsing: "SCORM_PARSING",
  transforming: "SCORM_TRANSFORMING",
  uploaded: "SCORM_UPLOADED",
} as const;

export const SCORM_PROCESSING_STEP = {
  parseCompleted: "PARSE_COMPLETED",
  parseQueued: "PARSE_QUEUED",
  parseRunning: "PARSE_RUNNING",
  transformQueued: "TRANSFORM_QUEUED",
  transformRunning: "TRANSFORM_RUNNING",
} as const;

export const SCORM_JOB_LEASE_SECONDS = 900;
export const SCORM_QUEUE_STALE_MS = 60_000;

export type ScormImportStatusKind = "ready" | "active" | "completed" | "failed" | "invalid";

export function classifyScormImportStatus(status: unknown): ScormImportStatusKind {
  if (status === SCORM_IMPORT_STATUS.analyzed || status === "ANALYZED") return "ready";
  if (
    status === SCORM_IMPORT_STATUS.parsing
    || status === "PARSING"
    || status === SCORM_IMPORT_STATUS.transforming
    || status === "TRANSFORMING"
  ) return "active";
  if (status === SCORM_IMPORT_STATUS.completed) return "completed";
  if (status === SCORM_IMPORT_STATUS.failed) return "failed";
  return "invalid";
}

export function isQueuedScormTransformation(status: unknown, processingStep: unknown): boolean {
  return classifyScormImportStatus(status) === "active"
    && status === SCORM_IMPORT_STATUS.transforming
    && processingStep === SCORM_PROCESSING_STEP.transformQueued;
}

export function isExpiredScormLease(leaseExpiresAt: unknown, nowMs = Date.now()): boolean {
  if (typeof leaseExpiresAt !== "string") return false;
  const expiresAt = Date.parse(leaseExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

export function isRecoverableScormJob(
  status: unknown,
  processingStep: unknown,
  leaseExpiresAt: unknown,
  updatedAt: unknown,
  nowMs = Date.now(),
): boolean {
  if (classifyScormImportStatus(status) !== "active") return false;
  const parsing = status === SCORM_IMPORT_STATUS.parsing;
  const queuedStep = parsing
    ? SCORM_PROCESSING_STEP.parseQueued
    : SCORM_PROCESSING_STEP.transformQueued;
  const runningStep = parsing
    ? SCORM_PROCESSING_STEP.parseRunning
    : SCORM_PROCESSING_STEP.transformRunning;

  if (processingStep === runningStep) return isExpiredScormLease(leaseExpiresAt, nowMs);
  if (processingStep !== queuedStep || typeof updatedAt !== "string") return false;
  const queuedAt = Date.parse(updatedAt);
  return Number.isFinite(queuedAt) && queuedAt <= nowMs - SCORM_QUEUE_STALE_MS;
}
