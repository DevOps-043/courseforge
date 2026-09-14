import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyScormImportStatus,
  isExpiredScormLease,
  isRecoverableScormJob,
  isQueuedScormTransformation,
  SCORM_IMPORT_STATUS,
  SCORM_PROCESSING_STEP,
  scormProcessRequestSchema,
} from "../scorm-job-contracts";

test("SCORM process requests require an exact UUID contract", () => {
  assert.equal(
    scormProcessRequestSchema.safeParse({ importId: "550e8400-e29b-41d4-a716-446655440000" }).success,
    true,
  );
  assert.equal(scormProcessRequestSchema.safeParse({ importId: "not-a-uuid" }).success, false);
  assert.equal(
    scormProcessRequestSchema.safeParse({
      importId: "550e8400-e29b-41d4-a716-446655440000",
      organizationId: "untrusted",
    }).success,
    false,
  );
});

test("SCORM transformation states distinguish ready, active and terminal imports", () => {
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.analyzed), "ready");
  assert.equal(classifyScormImportStatus("ANALYZED"), "ready");
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.parsing), "active");
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.transforming), "active");
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.completed), "completed");
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.failed), "failed");
  assert.equal(classifyScormImportStatus("SCORM_UPLOADED"), "invalid");
});

test("only the reserved queued step can be claimed by a background transformation", () => {
  assert.equal(
    isQueuedScormTransformation(
      SCORM_IMPORT_STATUS.transforming,
      SCORM_PROCESSING_STEP.transformQueued,
    ),
    true,
  );
  assert.equal(
    isQueuedScormTransformation(
      SCORM_IMPORT_STATUS.transforming,
      SCORM_PROCESSING_STEP.transformRunning,
    ),
    false,
  );
  assert.equal(
    isQueuedScormTransformation(SCORM_IMPORT_STATUS.completed, SCORM_PROCESSING_STEP.transformQueued),
    false,
  );
});

test("SCORM leases are recoverable only after a valid deadline expires", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");
  assert.equal(isExpiredScormLease("2026-09-10T11:59:59.000Z", now), true);
  assert.equal(isExpiredScormLease("2026-09-10T12:00:01.000Z", now), false);
  assert.equal(isExpiredScormLease(null, now), false);
  assert.equal(isExpiredScormLease("invalid", now), false);
});

test("SCORM queued jobs become recoverable when dispatch remains stale", () => {
  const now = Date.parse("2026-09-10T12:02:00.000Z");
  assert.equal(isRecoverableScormJob(
    SCORM_IMPORT_STATUS.parsing,
    SCORM_PROCESSING_STEP.parseQueued,
    null,
    "2026-09-10T12:00:00.000Z",
    now,
  ), true);
  assert.equal(isRecoverableScormJob(
    SCORM_IMPORT_STATUS.transforming,
    SCORM_PROCESSING_STEP.transformQueued,
    null,
    "2026-09-10T12:01:30.000Z",
    now,
  ), false);
  assert.equal(isRecoverableScormJob(
    SCORM_IMPORT_STATUS.completed,
    "COMPLETED",
    null,
    "2026-09-10T12:00:00.000Z",
    now,
  ), false);
});
