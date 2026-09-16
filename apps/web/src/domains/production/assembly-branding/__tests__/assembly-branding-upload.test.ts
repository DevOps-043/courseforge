import assert from "node:assert/strict";
import test from "node:test";
import {
  ABANDONED_ASSEMBLY_UPLOAD_RETENTION_MS,
  assemblyBrandingFinalizeSchema,
  assemblyBrandingSelectionSchema,
  isAbandonedAssemblyUpload,
  MAX_ASSEMBLY_VIDEO_BYTES,
  parseAssemblyBrandingStoragePath,
  resolveAssemblyCleanupPage,
  validateAssemblyVideoFile,
} from "../assembly-branding-upload";

test("assembly branding accepts only bounded MP4 or WebM files", () => {
  assert.deepEqual(
    validateAssemblyVideoFile({ size: 1024, type: "video/mp4" }),
    { success: true },
  );
  assert.deepEqual(
    validateAssemblyVideoFile({ size: MAX_ASSEMBLY_VIDEO_BYTES + 1, type: "video/webm" }),
    { reason: "too_large", success: false },
  );
  assert.deepEqual(
    validateAssemblyVideoFile({ size: 1024, type: "text/html" }),
    { reason: "unsupported_type", success: false },
  );
});

test("assembly branding selections reject unknown fields and invalid IDs", () => {
  assert.equal(
    assemblyBrandingSelectionSchema.safeParse({
      assetId: "8d15ec09-d2ae-4f24-a565-84c337f6c135",
      kind: "OUTRO",
    }).success,
    true,
  );
  assert.equal(
    assemblyBrandingSelectionSchema.safeParse({
      assetId: "not-a-uuid",
      kind: "OUTRO",
      organizationId: "attacker-controlled",
    }).success,
    false,
  );
});

test("assembly branding storage paths are bound to tenant and kind", () => {
  const organizationId = "9c011574-c17f-409e-8150-e4ae7550e7ce";
  const assetId = "8d15ec09-d2ae-4f24-a565-84c337f6c135";
  const path = `assembly-branding/${organizationId}/outro/${assetId}.mp4`;
  assert.deepEqual(
    parseAssemblyBrandingStoragePath(path, organizationId, "OUTRO"),
    { extension: "mp4", id: assetId },
  );
  assert.equal(
    parseAssemblyBrandingStoragePath(path, "2228a8aa-b380-4c9c-9ff7-376f226bc744", "OUTRO"),
    null,
  );
  assert.equal(parseAssemblyBrandingStoragePath(path, organizationId, "INTRO"), null);
});

test("direct upload finalization has an exact bounded contract", () => {
  const valid = {
    fileSizeBytes: 1024,
    kind: "OUTRO",
    mimeType: "video/mp4",
    name: "outro.mp4",
    path: "assembly-branding/9c011574-c17f-409e-8150-e4ae7550e7ce/outro/8d15ec09-d2ae-4f24-a565-84c337f6c135.mp4",
  };
  assert.equal(assemblyBrandingFinalizeSchema.safeParse(valid).success, true);
  assert.equal(
    assemblyBrandingFinalizeSchema.safeParse({ ...valid, organizationId: "forged" }).success,
    false,
  );
});

test("cleanup removes only unregistered uploads older than the retention window", () => {
  const nowMs = Date.parse("2026-09-11T12:00:00.000Z");
  const expired = new Date(nowMs - ABANDONED_ASSEMBLY_UPLOAD_RETENTION_MS - 1).toISOString();
  const recent = new Date(nowMs - ABANDONED_ASSEMBLY_UPLOAD_RETENTION_MS + 1).toISOString();

  assert.equal(isAbandonedAssemblyUpload({ createdAt: expired, isRegistered: false, nowMs }), true);
  assert.equal(isAbandonedAssemblyUpload({ createdAt: expired, isRegistered: true, nowMs }), false);
  assert.equal(isAbandonedAssemblyUpload({ createdAt: recent, isRegistered: false, nowMs }), false);
  assert.equal(isAbandonedAssemblyUpload({ createdAt: "invalid", isRegistered: false, nowMs }), false);
});

test("cleanup rotates bounded organization pages without exceeding the total", () => {
  const hourMs = 60 * 60 * 1000;
  assert.deepEqual(
    resolveAssemblyCleanupPage({ nowMs: 0, pageSize: 25, totalOrganizations: 51 }),
    { from: 0, to: 24 },
  );
  assert.deepEqual(
    resolveAssemblyCleanupPage({ nowMs: hourMs, pageSize: 25, totalOrganizations: 51 }),
    { from: 25, to: 49 },
  );
  assert.deepEqual(
    resolveAssemblyCleanupPage({ nowMs: hourMs * 2, pageSize: 25, totalOrganizations: 51 }),
    { from: 50, to: 50 },
  );
  assert.deepEqual(
    resolveAssemblyCleanupPage({ nowMs: hourMs * 3, pageSize: 25, totalOrganizations: 51 }),
    { from: 0, to: 24 },
  );
  assert.equal(
    resolveAssemblyCleanupPage({ nowMs: 0, pageSize: 25, totalOrganizations: 0 }),
    null,
  );
});
