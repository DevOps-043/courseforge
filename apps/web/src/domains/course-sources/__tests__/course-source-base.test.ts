import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reserveDocumentaryBase, retryUnclaimedDocumentaryBase } from "../course-source-base.service";

const organizationId = "10000000-0000-4000-8000-000000000001";
const artifactId = "20000000-0000-4000-8000-000000000001";
const runId = "30000000-0000-4000-8000-000000000001";
const input = { artifactId, runId, description: "Formar al equipo en el procedimiento descrito en el manual." };

function fixture({ ready = true, policy = "DOCUMENTS_ONLY" as string | null } = {}) {
  const artifact = {
    id: artifactId, organization_id: organizationId, state: "DRAFT", updated_at: "initial",
    course_id: `DOC-${artifactId}`,
    idea_central: "Manual de SofLIA", generation_metadata: {} as Record<string, unknown>, source_evidence_id: null,
  };
  const tables: Record<string, Record<string, unknown>[]> = {
    artifacts: [artifact],
    course_source_drafts: [{ artifact_id: artifactId, organization_id: organizationId }],
    course_source_settings: [{ artifact_id: artifactId, organization_id: organizationId, policy, revision: 1, approved_revision: null }],
    course_source_documents: ready ? [{ artifact_id: artifactId, organization_id: organizationId, status: "READY" }] : [],
  };
  let writes = 0;
  const admin = {
    from(table: string) {
      const filters: [string, unknown][] = [];
      let update: Record<string, unknown> | undefined;
      const query = {
        select: () => query, limit: () => query,
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        update(values: Record<string, unknown>) { update = values; return query; },
        async maybeSingle() {
          const row = tables[table].find(entry => filters.every(([column, value]) => {
            let actual: unknown = entry;
            for (const key of column.split(/->>?/)) actual = (actual as Record<string, unknown> | undefined)?.[key];
            return (column.includes("->>") ? String(actual) : actual) === value;
          }));
          if (row && update) { Object.assign(row, update, { updated_at: "reserved" }); writes++; }
          return { data: row ? { ...row } : null, error: null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { admin, artifact, writes: () => writes };
}

test("Base reserva una sola ejecución para el mismo borrador y conserva el input para reintentos", async () => {
  const { admin, artifact, writes } = fixture();
  const results = await Promise.allSettled([
    reserveDocumentaryBase(admin, organizationId, input, { scope: "staging", userId: runId }),
    reserveDocumentaryBase(admin, organizationId, { ...input, runId: "30000000-0000-4000-8000-000000000002" }, { scope: "staging", userId: runId }),
  ]);
  const accepted = results.filter(result => result.status === "fulfilled" && result.value);
  assert.equal(accepted.length, 1);
  assert.equal(writes(), 1);
  assert.equal(artifact.id, artifactId);
  assert.equal(artifact.state, "GENERATING");
  assert.equal(artifact.generation_metadata.run_id, runId);
  assert.equal((artifact.generation_metadata.base_queue as { scope: string }).scope, "staging");
  assert.deepEqual(artifact.generation_metadata.original_input, accepted[0].status === "fulfilled" && accepted[0].value);
  assert.equal(await reserveDocumentaryBase(admin, organizationId, input), null);
});

test("Base no escribe si falta la política, el documento listo o la organización correcta", async () => {
  for (const [options, expected] of [[{ ready: false }, /Texto disponible/], [{ policy: null }, /Guarda una política/]] as const) {
    const { admin, writes } = fixture(options);
    await assert.rejects(reserveDocumentaryBase(admin, organizationId, input), expected);
    assert.equal(writes(), 0);
  }
  const { admin, writes } = fixture();
  await assert.rejects(reserveDocumentaryBase(admin, artifactId, input), /No se encontró/);
  assert.equal(writes(), 0);
});

test("Base permite un solo reintento de la reserva sin tomar en el mismo borrador", async () => {
  const { admin, artifact, writes } = fixture();
  await reserveDocumentaryBase(admin, organizationId, input, { scope: "despliegue-anterior", userId: runId });
  assert.equal(await retryUnclaimedDocumentaryBase(admin, organizationId, artifactId, runId, "staging"), false);
  artifact.generation_metadata.started_at = new Date(Date.now() - 61_000).toISOString();
  assert.equal(await retryUnclaimedDocumentaryBase(admin, artifactId, artifactId, runId, "staging"), false);
  const results = await Promise.all([
    retryUnclaimedDocumentaryBase(admin, organizationId, artifactId, runId, "staging"),
    retryUnclaimedDocumentaryBase(admin, organizationId, artifactId, runId, "staging"),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(writes(), 2);
  assert.equal(artifact.generation_metadata.run_id, runId);
  const queue = artifact.generation_metadata.base_queue as { scope: string; invocations: number };
  assert.equal(queue.scope, "staging");
  assert.equal(queue.invocations, 0);
  queue.invocations = 1;
  artifact.generation_metadata.started_at = new Date(Date.now() - 61_000).toISOString();
  assert.equal(await retryUnclaimedDocumentaryBase(admin, organizationId, artifactId, runId, "otro-despliegue"), false);
  assert.equal(writes(), 2);
});
