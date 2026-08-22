import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  summarizeHyperframesValidationIssues,
  validateHyperframesCompositionId,
} from "../hyperframes-request-validation";

test("accepts UUID composition identifiers and rejects route placeholders", () => {
  const compositionId = "10000000-0000-4000-8000-000000000001";

  assert.deepEqual(validateHyperframesCompositionId(compositionId), {
    data: compositionId,
    success: true,
  });
  assert.equal(validateHyperframesCompositionId("undefined").success, false);
  assert.equal(validateHyperframesCompositionId("").success, false);
});

test("summarizes nested validation failures without copying rejected input", () => {
  const parsed = z.object({
    clips: z.array(z.object({ label: z.string().max(3) })),
  }).safeParse({ clips: [{ label: "sensitive-long-label" }] });

  assert.equal(parsed.success, false);
  if (parsed.success) return;

  assert.deepEqual(summarizeHyperframesValidationIssues(parsed.error), [{
    code: "too_big",
    message: "Too big: expected string to have <=3 characters",
    path: "clips.0.label",
  }]);
  assert.doesNotMatch(
    JSON.stringify(summarizeHyperframesValidationIssues(parsed.error)),
    /sensitive-long-label/,
  );
});
