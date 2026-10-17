import assert from "node:assert/strict";
import test from "node:test";
import { historicalHtmlInspectionGuidance, historicalHtmlMetadataGuidance } from "../composition-html-editing-historical-continuity";

test("metadata guidance preserves unsupported inventory and never invents replacement pins", () => {
  assert.equal(historicalHtmlMetadataGuidance("HTML_PIN_REQUIRES_BYTE_INSPECTION").code, "INSPECT_PINNED_BYTES");
  const missing = historicalHtmlMetadataGuidance("MISSING_OR_INVALID_HTML_METADATA");
  assert.equal(missing.code, "INVESTIGATE_METADATA"); assert.match(missing.instruction, /No reconstruyas pins/);
  assert.equal(historicalHtmlMetadataGuidance("NOT_MARKED_AS_SNAPSHOT").code, "PRESERVE_NON_SNAPSHOT_RECORD");
});

test("historical review guidance is separate from current-profile validation and does not promise a compiler fallback", () => {
  for (const status of ["LEGACY_V1_REQUIRES_REVIEW", "PROFILE_MISMATCH_REQUIRES_REVIEW"] as const) {
    const result = historicalHtmlInspectionGuidance({scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION", status,
      revisionCount: 1, profileDifferences: status === "PROFILE_MISMATCH_REQUIRES_REVIEW" ? ["geometryVersion"] : []});
    assert.equal(result.code, "PREPARE_SEPARATE_REVIEWED_REVISION");
    assert.match(result.instruction, /no instala un ejecutor histórico/); assert.match(result.instruction, /Nunca activa/);
  }
  assert.equal(historicalHtmlInspectionGuidance({scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION",
    status: "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS", revisionCount: 1, profileDifferences: []}).code, "VERIFY_CURRENT_CONTENT_AND_AUTHORITY");
});

test("all rejected diagnoses remain blocking and distinguish identity from unsupported content", () => {
  for (const reason of ["INVALID_BUNDLE", "BYTE_INTEGRITY_MISMATCH", "SCOPE_MISMATCH", "AUTHORITY_SET_MISMATCH",
    "COMPILATION_VERSION_MISMATCH", "COMPILATION_OUTPUT_MISMATCH"] as const) {
    const diagnostic = {scope: "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION" as const, status: "REJECTED" as const, reason};
    const before = JSON.stringify(diagnostic), result = historicalHtmlInspectionGuidance(diagnostic);
    assert.equal(result.code, reason === "BYTE_INTEGRITY_MISMATCH" || reason === "SCOPE_MISMATCH"
      ? "INVESTIGATE_IDENTITY_OR_INTEGRITY" : "PRESERVE_UNSUPPORTED_ARCHIVE");
    assert.equal(JSON.stringify(diagnostic), before); assert.equal("approved" in result, false);
  }
});
