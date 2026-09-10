import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyScormImportStatus,
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
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.transforming), "active");
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.completed), "completed");
  assert.equal(classifyScormImportStatus(SCORM_IMPORT_STATUS.failed), "failed");
  assert.equal(classifyScormImportStatus("SCORM_UPLOADED"), "invalid");
});

test("only the reserved queued step can be claimed by a background transformation", () => {
  assert.equal(
    isQueuedScormTransformation(
      SCORM_IMPORT_STATUS.transforming,
      SCORM_PROCESSING_STEP.queued,
    ),
    true,
  );
  assert.equal(
    isQueuedScormTransformation(
      SCORM_IMPORT_STATUS.transforming,
      SCORM_PROCESSING_STEP.running,
    ),
    false,
  );
  assert.equal(
    isQueuedScormTransformation(SCORM_IMPORT_STATUS.completed, SCORM_PROCESSING_STEP.queued),
    false,
  );
});
