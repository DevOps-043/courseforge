import assert from "node:assert/strict";
import test from "node:test";
import {
  activateCompositionSnapshot,
  listCompositionSnapshots,
} from "../composition-snapshot.service";

const COMPOSITION_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const ACTIVE_REVISION_ID = "30000000-0000-4000-8000-000000000002";

test("lists persisted snapshots and identifies the active revision", async () => {
  const compositionQuery = chain({ active_revision_id: ACTIVE_REVISION_ID, status: "READY_FOR_RENDER" });
  const revisionRows = [
    {
      created_at: "2026-08-21T18:00:00.000Z",
      id: ACTIVE_REVISION_ID,
      manifest: { draft_document_hash: "b".repeat(64), draft_document_version: 8, snapshot: true },
      project_archive_size_bytes: 2048,
      revision_number: 2,
    },
    {
      created_at: "2026-08-21T17:00:00.000Z",
      id: "30000000-0000-4000-8000-000000000001",
      manifest: { draft_document_hash: "a".repeat(64), draft_document_version: 5, snapshot: true },
      project_archive_size_bytes: 1024,
      revision_number: 1,
    },
  ];
  const revisionsQuery = chain(revisionRows, false);
  const supabase = {
    from: (table: string) => table === "video_compositions" ? compositionQuery : revisionsQuery,
  };

  const result = await listCompositionSnapshots({
    compositionId: COMPOSITION_ID,
    organizationId: ORGANIZATION_ID,
    supabase: supabase as never,
  });

  assert.equal(result.status, "READY_FOR_RENDER");
  assert.equal(result.activeRevisionId, ACTIVE_REVISION_ID);
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.snapshots[0]?.isActive, true);
  assert.equal(result.snapshots[0]?.documentVersion, 8);
  assert.equal("project_storage_path" in (result.snapshots[0] || {}), false);
});

test("reactivates only a snapshot owned by the composition and revokes approval", async () => {
  const revisionQuery = chain({
    created_at: "2026-08-21T17:00:00.000Z",
    id: ACTIVE_REVISION_ID,
    manifest: { draft_document_hash: "c".repeat(64), draft_document_version: 4, snapshot: true },
    project_archive_size_bytes: 4096,
    revision_number: 3,
  });
  const updates: Array<Record<string, unknown>> = [];
  const compositionQuery = chain({ id: COMPOSITION_ID });
  compositionQuery.update = (value: Record<string, unknown>) => {
    updates.push(value);
    return compositionQuery;
  };
  const supabase = {
    from: (table: string) => table === "video_composition_revisions" ? revisionQuery : compositionQuery,
  };

  const restored = await activateCompositionSnapshot({
    compositionId: COMPOSITION_ID,
    organizationId: ORGANIZATION_ID,
    revisionId: ACTIVE_REVISION_ID,
    supabase: supabase as never,
  });

  assert.equal(restored.id, ACTIVE_REVISION_ID);
  assert.equal(restored.status, "READY_FOR_PREVIEW");
  assert.equal(restored.documentVersion, 4);
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.active_revision_id, ACTIVE_REVISION_ID);
  assert.equal(updates[0]?.status, "READY_FOR_PREVIEW");
});

function chain(data: unknown, single = true) {
  const query: Record<string, any> = {};
  for (const method of ["contains", "eq", "limit", "order", "select"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => ({ data: single ? data : null, error: null });
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
  return query;
}
