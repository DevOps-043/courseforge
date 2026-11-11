import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { BASE_BATCH_LIMITS, planBaseBatches, readBaseBatches } from "../course-source-base-batches";
import type { GenerationSource } from "../course-source-generation";

test("el conteo optimizado conserva el plan persistido de Base", () => {
  const sources: GenerationSource[] = Array.from({ length: 266 }, (_, index) => ({
    id: String(index).padStart(36, "0"), kind: "DOCUMENT", title: "Manual", locator: {}, hash: "hash",
    text: "La fuente debe respaldar el propósito del taller. ".repeat(42).slice(0, 2000),
  }));
  const { batches } = planBaseBatches("Propósito de referencia", sources);
  // Huella del plan serializado con el contador anterior, incluidas las reservas por lote.
  assert.equal(createHash("sha256").update(JSON.stringify(batches)).digest("hex"),
    "b2eb90e43d2bfd9eb77d586cc9a2b73838ad6ebfd7414c26661f1124f1db5682");
});

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

test("Base lee tres lotes en paralelo y reanuda solo el que falló", async () => {
  const sources: GenerationSource[] = Array.from({ length: 6 }, (_, index) => ({
    id: randomUUID(), kind: "DOCUMENT", title: "Manual", locator: {},
    text: `Regla ${index}: exige una autorización expresa.`, hash: "hash",
  }));
  const states = sources.map(() => "pending");
  const findings = new Map<number, unknown[]>();
  const attempts: number[] = [];
  let active = 0;
  let maxActive = 0;
  const run = () => readBaseBatches({
    purpose: "Preparar taller", sources, resume: true, deadline: Date.now() + 10_000,
    progress: async () => ({
      status: findings.size === sources.length ? "COMPLETE" : states.includes("pending") ? "ACTIVE" : "PAUSED",
      confirmed: findings.size,
      total: sources.length,
      resumable: states.flatMap((state, index) => state === "paused" ? [[index + 1]] : []),
      findings: [...findings.values()],
    }),
    command: async (action, path, _lease, payload) => {
      if (action === "claim_wave") {
        const leases = states.flatMap((state, index) => state === "pending" ? [index] : [])
          .slice(0, BASE_BATCH_LIMITS.concurrentBatches).map(index => {
            states[index] = "leased";
            return { status: "LEASED", path: [index + 1], lease: randomUUID(),
              fragmentIds: [sources[index].id], correctionUsed: false };
          });
        return leases.length ? { status: "LEASED", leases } : { status: "NO_AVAILABLE_BATCH" };
      }
      const index = path![0] - 1;
      if (action === "resume") {
        states[index] = "pending";
        return { status: "PENDING" };
      }
      if (action === "fail") {
        states[index] = "paused";
        return { status: "PAUSED" };
      }
      assert.equal(action, "complete");
      states[index] = "confirmed";
      findings.set(index, payload!.findings as unknown[]);
      return { status: "CONFIRMED" };
    },
    generate: async prompt => {
      const index = sources.findIndex(source => prompt.includes(source.id));
      const fail = index === 1 && !attempts.includes(index);
      attempts.push(index);
      maxActive = Math.max(maxActive, ++active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active--;
      if (fail) throw Object.assign(new Error("Proveedor temporalmente indisponible"), { statusCode: 503 });
      return { findings: [{ fragmentId: sources[index].id, quote: sources[index].text, finding: "Verificar la autorización" }] };
    },
  });
  await assert.rejects(run(), /5 de 6 lotes/);
  assert.equal(maxActive, 3);
  assert.deepEqual(attempts, [0, 1, 2, 3, 4, 5]);
  assert.equal((await run()).length, sources.length);
  assert.deepEqual(attempts, [0, 1, 2, 3, 4, 5, 1]);
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
  const reported: number[] = [];
  let next = 0;
  let interrupted = false;
  let paused = false;
  const run = () => readBaseBatches({
    purpose, sources, deadline: Date.now() + 30_000, resume: true,
    onProgress: async ({ confirmed: count, total }) => {
      assert.equal(total, plan.length);
      reported.push(count);
    },
    progress: async () => next === plan.length
      ? { status: "COMPLETE", confirmed: next, total: plan.length, findings: [...confirmed.values()] }
      : { status: paused ? "PAUSED" : "ACTIVE", confirmed: next, total: plan.length, resumable: paused ? [[next + 1]] : [] },
    command: async (action, path, _lease, payload) => {
      if (action === "claim_wave") return paused ? { status: "NO_AVAILABLE_BATCH" } : {
        status: "LEASED", leases: [{ status: "LEASED", path: [next + 1], lease: randomUUID(),
        fragmentIds: plan[next].fragmentIds, correctionUsed: false,
        }],
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
  assert.deepEqual(reported, [0, 1]);
  const context = await run();
  assert.deepEqual(reported.slice(2), Array.from({ length: plan.length }, (_, index) => index + 1));
  assert.deepEqual(attempts, [0, 1, ...plan.slice(1).map((_, index) => index + 1)]);
  assert.deepEqual(context.map(source => source.id), [sources[0].id, sources[50].id, sources.at(-1)!.id]);
});
