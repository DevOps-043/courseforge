import assert from "node:assert/strict";
import test from "node:test";
import { decideSourceBatchRecovery, planSourceBatches } from "../course-source-batches";

const options = {
  maxInputTokens: 12,
  maxBatches: 3,
  countRequestTokens: (parts: readonly string[]) => 3 + parts.join("|").length,
};

test("preserva el orden y la última sección dentro del presupuesto con instrucciones", () => {
  const parts = ["inicio", "medio", "final"];
  const batches = planSourceBatches(parts, options);
  assert.equal(batches.length, 3);
  assert.deepEqual(batches.flat(), parts);
  assert.ok(batches.every(batch => options.countRequestTokens(batch) <= options.maxInputTokens));
});

test("rechaza exceso de lotes o un fragmento demasiado grande sin truncar", () => {
  assert.throws(() => planSourceBatches(["inicio", "medio", "final"], { ...options, maxBatches: 2 }), /máximo de lotes/);
  assert.throws(() => planSourceBatches(["inicio", "x".repeat(10)], options), /Un fragmento/);
});

test("distingue reintento, división, corrección única y agotamiento", () => {
  const run = { attemptsRemaining: 2, budgetRemaining: true, fragmentCount: 2, correctionUsed: false };
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "TRANSIENT" }), "RETRY_WITH_BACKOFF");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "CONTEXT_LIMIT" }), "SPLIT");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "CONTEXT_LIMIT", fragmentCount: 1 }), "PAUSE");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "INVALID_OUTPUT" }), "CORRECT");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "INVALID_OUTPUT", correctionUsed: true }), "PAUSE");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "TRANSIENT", attemptsRemaining: 0 }), "PAUSE");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "TRANSIENT", budgetRemaining: false }), "PAUSE");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "PERMANENT" }), "PAUSE");
  assert.equal(decideSourceBatchRecovery({ ...run, failure: "STALE", budgetRemaining: false }), "INVALIDATE");
});
