import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BASE_BATCH_LIMITS, planBaseBatches, readBaseBatches } from "../course-source-base-batches";
import type { GenerationSource } from "../course-source-generation";

test("el presupuesto de Base admite el máximo de un archivo con texto multibyte", () => {
  const sources: GenerationSource[] = Array.from({ length: 600 }, () => ({
    id: randomUUID(), kind: "DOCUMENT", title: "Manual", locator: {}, text: "文".repeat(2000), hash: "hash",
  }));
  const { batches: plan, limits, findingsPerBatch } = planBaseBatches("文".repeat(3000), sources);
  assert.deepEqual(plan.flatMap(batch => batch.fragmentIds), sources.map(source => source.id));
  assert.equal(limits.planner, "base-evidence-v2");
  assert.ok(plan.reduce((total, batch) => total + batch.requestTokens, 0) < limits.totalUnits);
  assert.ok(findingsPerBatch > 0 && findingsPerBatch < 4);
});

test("Base recorre el documento largo y al recuperar el lote intermedio conserva el avance", async () => {
  const sources: GenerationSource[] = Array.from({ length: 100 }, (_, index) => ({
    id: randomUUID(), kind: "DOCUMENT", title: "Manual", locator: { characterStart: index * 2000 },
    text: `Regla ${index}: requiere autorización expresa. `.padEnd(2000, "a"), hash: "hash",
  }));
  const purpose = "Preparar taller de seguridad";
  const { batches: plan, limits } = planBaseBatches(purpose, sources);
  assert.equal(limits.planner, BASE_BATCH_LIMITS.planner);
  assert.deepEqual(plan.flatMap(batch => batch.fragmentIds), sources.map(source => source.id));
  assert.ok(plan.every(batch => batch.requestTokens <= BASE_BATCH_LIMITS.requestUnits));
  const confirmed = new Map<number, unknown[]>();
  const attempts: number[] = [];
  let next = 0;
  let interrupted = false;
  let paused = false;
  const run = () => readBaseBatches({
    purpose, sources, deadline: Date.now() + 30_000, resume: true,
    progress: async () => next === plan.length
      ? { status: "COMPLETE", findings: [...confirmed.values()] }
      : { status: paused ? "PAUSED" : "ACTIVE", resumable: paused ? [[next + 1]] : [] },
    command: async (action, path, _lease, payload) => {
      if (action === "claim") return paused ? { status: "NO_AVAILABLE_BATCH" } : {
        status: "LEASED", path: [next + 1], lease: randomUUID(),
        fragmentIds: plan[next].fragmentIds, correctionUsed: false,
      };
      assert.deepEqual(path, [next + 1]);
      if (action === "resume") {
        paused = false;
        return { status: "PENDING" };
      }
      if (action === "fail") {
        assert.equal(payload?.diagnostic, "TRANSIENT");
        paused = true;
        return { status: "PAUSED" };
      }
      assert.equal(action, "complete");
      confirmed.set(next++, payload?.findings as unknown[]);
      return { status: "CONFIRMED" };
    },
    generate: async prompt => {
      attempts.push(next);
      if (next === 1 && !interrupted) {
        interrupted = true;
        throw Object.assign(new Error("Proveedor no disponible"), { statusCode: 503 });
      }
      const findings = [sources[0], sources[50], sources.at(-1)!]
        .filter(source => prompt.includes(source.id))
        .map(source => ({ fragmentId: source.id, quote: source.text.split(". ")[0] + ".", finding: "Validar autorización" }));
      return { findings };
    },
  });
  await assert.rejects(run(), /lotes confirmados/);
  assert.deepEqual([...confirmed.keys()], [0]);
  const context = await run();
  assert.deepEqual(attempts, [0, 1, ...plan.slice(1).map((_, index) => index + 1)]);
  assert.deepEqual(context.map(source => source.id), [sources[0].id, sources[50].id, sources.at(-1)!.id]);
});
