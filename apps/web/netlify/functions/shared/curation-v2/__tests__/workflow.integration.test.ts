import assert from "node:assert/strict";
import {
  SYSTEM_GENERATED_CURATION_ROW_FILTER,
  isSystemGeneratedCurationRow,
} from "../../../../../src/domains/curation/lib/curation-row-rules";
import type { CurationRow } from "../../../../../src/domains/curation/types/curation.types";
import { validateAutomaticCandidates } from "../workflow";
import type { CurationValidationReport, UrlValidationResult } from "../types";

function report(status: CurationValidationReport["status"]): CurationValidationReport {
  return {
    status,
    checked_at: new Date(0).toISOString(),
    reason: status === "valid" ? "ok" : "invalid",
    checks: {
      blocked_domain: false,
      duplicate: false,
      http_ok: status === "valid",
      minimum_content: status === "valid",
      paywall: false,
      soft_404: false,
      valid_mime: status === "valid",
    },
  };
}

async function run() {
  const existing = new Set(["https://existing.example/"]);
  const selected = await validateAutomaticCandidates({
  candidates: [
    {
      lesson_id: "lesson-1",
      url: "https://invalid.example/",
      title: "Invalid",
      rationale: "",
    },
    {
      lesson_id: "lesson-1",
      url: "https://valid-one.example/",
      title: "Valid one",
      rationale: "",
    },
    {
      lesson_id: "lesson-1",
      url: "https://valid-two.example/",
      title: "Valid two",
      rationale: "",
    },
    {
      lesson_id: "lesson-1",
      url: "https://valid-three.example/",
      title: "Valid three",
      rationale: "",
    },
  ],
  existingNormalizedUrls: existing,
  validate: async (url): Promise<UrlValidationResult> => ({
    isValid: !url.includes("invalid"),
    normalizedUrl: url,
    report: report(url.includes("invalid") ? "invalid" : "valid"),
  }),
  });

  assert.deepEqual(
    selected.map((item) => item.candidate.title),
    ["Valid one", "Valid two"],
  );
  assert.equal(existing.has("https://valid-one.example/"), true);
  assert.equal(existing.has("https://valid-three.example/"), false);

  const automatic = { origin: "automatic", auto_evaluated: true } as CurationRow;
  const manual = { origin: "manual", auto_evaluated: true } as CurationRow;
  assert.equal(SYSTEM_GENERATED_CURATION_ROW_FILTER, "origin.eq.automatic");
  assert.equal(isSystemGeneratedCurationRow(automatic), true);
  assert.equal(isSystemGeneratedCurationRow(manual), false);
}

void run().then(() => {
  console.log("curation-v2 workflow integration tests passed");
});
