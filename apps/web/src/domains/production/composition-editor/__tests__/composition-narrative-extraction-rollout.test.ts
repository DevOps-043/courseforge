import assert from "node:assert/strict";
import test from "node:test";
import { narrativeExtractionPersistenceReady, narrativeExtractionApplyEnabled, narrativeExtractionOrganizationEnabled } from "../http/composition-narrative-extraction-rollout.server";

test("rollout requires explicit persistence acknowledgement and enabled flag; recovery can survive rollback", () => {
  const previousReady = process.env.NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY;
  const previousEnabled = process.env.NARRATIVE_EXTRACTION_ENABLED;
  try {
    delete process.env.NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY; delete process.env.NARRATIVE_EXTRACTION_ENABLED;
    assert.equal(narrativeExtractionApplyEnabled(), false); assert.equal(narrativeExtractionPersistenceReady(), false);
    process.env.NARRATIVE_EXTRACTION_ENABLED = "true"; assert.equal(narrativeExtractionApplyEnabled(), false);
    process.env.NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY = "true"; assert.equal(narrativeExtractionApplyEnabled(), true);
    process.env.NARRATIVE_EXTRACTION_ENABLED = "false";
    assert.equal(narrativeExtractionApplyEnabled(), false); assert.equal(narrativeExtractionPersistenceReady(), true);
  } finally {
    if (previousReady === undefined) delete process.env.NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY;
    else process.env.NARRATIVE_EXTRACTION_ATOMIC_RECEIPTS_READY = previousReady;
    if (previousEnabled === undefined) delete process.env.NARRATIVE_EXTRACTION_ENABLED;
    else process.env.NARRATIVE_EXTRACTION_ENABLED = previousEnabled;
  }
});
test("pilot organization allowlist is strict, bounded and closed when malformed", () => {
  const previous = process.env.NARRATIVE_EXTRACTION_ORGANIZATION_IDS;
  const id = "11111111-1111-4111-8111-111111111111";
  try {
    for (const raw of ["", "*", `${id},invalid`, Array(1001).fill(id).join(",")]) {
      process.env.NARRATIVE_EXTRACTION_ORGANIZATION_IDS = raw; assert.equal(narrativeExtractionOrganizationEnabled(id), false);
    }
    process.env.NARRATIVE_EXTRACTION_ORGANIZATION_IDS = ` ${id} `;
    assert.equal(narrativeExtractionOrganizationEnabled(id), true);
    assert.equal(narrativeExtractionOrganizationEnabled("22222222-2222-4222-8222-222222222222"), false);
  } finally {
    if (previous === undefined) delete process.env.NARRATIVE_EXTRACTION_ORGANIZATION_IDS;
    else process.env.NARRATIVE_EXTRACTION_ORGANIZATION_IDS = previous;
  }
});
