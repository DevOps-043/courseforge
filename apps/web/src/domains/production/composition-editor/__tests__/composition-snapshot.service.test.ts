import assert from "node:assert/strict";
import test from "node:test";
import {
  activateCompositionSnapshot,
  assertCompositionSnapshotRenderContract,
  listCompositionSnapshots,
} from "../composition-snapshot.service";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";

const COMPOSITION_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const ACTIVE_REVISION_ID = "30000000-0000-4000-8000-000000000002";
const DRAFT_ID = "50000000-0000-4000-8000-000000000001";
const USER_ID = "60000000-0000-4000-8000-000000000001";

test("rejects legacy documents before creating a paid render snapshot", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "a".repeat(64),
      durationSeconds: 10,
      fileSizeBytes: 1024,
      hasAudio: false,
      mimeType: "video/mp4",
      productionAssetId: "40000000-0000-4000-8000-000000000001",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "broll/silent.mp4",
      timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Prueba", title: "Snapshot" },
  });

  assert.doesNotThrow(() => assertCompositionSnapshotRenderContract(document));
  document.canvas.fps = 30;
  assert.throws(() => assertCompositionSnapshotRenderContract(document), /25 FPS/);
  document.canvas.fps = 25;
  const clip = document.clips.find((candidate) => candidate.source.type === "PRODUCTION_ASSET")!;
  if (clip.source.type !== "PRODUCTION_ASSET") throw new Error("Expected production asset.");
  delete clip.source.hasAudio;
  assert.throws(() => assertCompositionSnapshotRenderContract(document), /metadatos de audio/);
});

test("lists persisted snapshots and identifies the active revision", async () => {
  const document = createDocument();
  const currentDocumentHash = hashCompositionDocument(document);
  const compositionQuery = chain({ active_revision_id: ACTIVE_REVISION_ID, status: "READY_FOR_RENDER" });
  const revisionRows = [
    {
      created_at: "2026-08-21T18:00:00.000Z",
      id: ACTIVE_REVISION_ID,
      manifest: {
        draft_document_hash: currentDocumentHash,
        draft_document_version: 8,
        render_profile: {
          format: "mp4",
          fps: 25,
          id: "balanced",
          quality: "standard",
          resolution: "1080p",
        },
        snapshot: true,
      },
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
    from: (table: string) => {
      if (table === "video_compositions") return compositionQuery;
      if (table === "video_composition_drafts") return chain({ id: DRAFT_ID });
      if (table === "video_composition_draft_documents") {
        return chain({ document, document_hash: currentDocumentHash, version: 8 });
      }
      return revisionsQuery;
    },
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
  assert.equal(result.snapshots[0]?.isCurrentDocument, true);
  assert.equal(result.snapshots[0]?.documentVersion, 8);
  assert.deepEqual(result.snapshots[0]?.renderProfile, {
    format: "mp4",
    fps: 25,
    quality: "standard",
    resolution: "1080p",
  });
  assert.equal("id" in (result.snapshots[0]?.renderProfile || {}), false);
  assert.equal(result.snapshots[0]?.renderProfileId, "balanced");
  assert.equal(result.snapshots[1]?.renderProfile, null);
  assert.equal(result.snapshots[1]?.renderProfileId, null);
  assert.equal(result.snapshots[1]?.isCurrentDocument, false);
  assert.equal("project_storage_path" in (result.snapshots[0] || {}), false);
});

test("restores a snapshot into the editable timeline and revokes approval", async () => {
  const document = createDocument();
  const documentHash = hashCompositionDocument(document);
  const revisionQuery = chain({
    created_at: "2026-08-21T17:00:00.000Z",
    id: ACTIVE_REVISION_ID,
    manifest: { draft_document_hash: documentHash, draft_document_version: 4, snapshot: true },
    project_archive_size_bytes: 4096,
    revision_number: 3,
  });
  const rpcCalls: Array<{ args: Record<string, unknown>; name: string }> = [];
  const supabase = {
    from: () => revisionQuery,
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ args, name });
      return rpcChain([{
        document,
        document_hash: documentHash,
        outcome: "RESTORED",
        version: 9,
      }]);
    },
  };

  const restored = await activateCompositionSnapshot({
    compositionId: COMPOSITION_ID,
    draftId: DRAFT_ID,
    expectedDocumentHash: "d".repeat(64),
    organizationId: ORGANIZATION_ID,
    revisionId: ACTIVE_REVISION_ID,
    supabase: supabase as never,
    userId: USER_ID,
  });

  assert.equal(restored.id, ACTIVE_REVISION_ID);
  assert.equal(restored.status, "READY_FOR_PREVIEW");
  assert.equal(restored.documentVersion, 4);
  assert.equal(restored.restoredVersion, 9);
  assert.equal(restored.documentHash, documentHash);
  assert.deepEqual(restored.document, document);
  assert.equal(restored.isCurrentDocument, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0]?.name, "restore_video_composition_snapshot_to_editor");
  assert.deepEqual(rpcCalls[0]?.args, {
    p_actor_id: USER_ID,
    p_composition_id: COMPOSITION_ID,
    p_draft_id: DRAFT_ID,
    p_expected_document_hash: "d".repeat(64),
    p_organization_id: ORGANIZATION_ID,
    p_revision_id: ACTIVE_REVISION_ID,
  });
});

test("rejects snapshot restoration when the editable timeline changed concurrently", async () => {
  const document = createDocument();
  const documentHash = hashCompositionDocument(document);
  const revisionQuery = chain({
    created_at: "2026-08-21T17:00:00.000Z",
    id: ACTIVE_REVISION_ID,
    manifest: { draft_document_hash: documentHash, draft_document_version: 4, snapshot: true },
    project_archive_size_bytes: 4096,
    revision_number: 3,
  });
  const supabase = {
    from: () => revisionQuery,
    rpc: () => rpcChain([{
      document,
      document_hash: documentHash,
      outcome: "CONFLICT",
      version: 10,
    }]),
  };

  await assert.rejects(
    activateCompositionSnapshot({
      compositionId: COMPOSITION_ID,
      draftId: DRAFT_ID,
      expectedDocumentHash: "e".repeat(64),
      organizationId: ORGANIZATION_ID,
      revisionId: ACTIVE_REVISION_ID,
      supabase: supabase as never,
      userId: USER_ID,
    }),
    (error: unknown) => error instanceof Error
      && error.message.includes("cambió en otra sesión")
      && "status" in error
      && error.status === 409,
  );
});

function createDocument() {
  return createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "f".repeat(64),
      durationSeconds: 10,
      fileSizeBytes: 1024,
      hasAudio: false,
      mimeType: "video/mp4",
      productionAssetId: "70000000-0000-4000-8000-000000000001",
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "broll/snapshot.mp4",
      timelineRole: "BROLL",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 10, subtitle: "Prueba", title: "Snapshot" },
  });
}

function chain(data: unknown, single = true) {
  const query: Record<string, any> = {};
  for (const method of ["contains", "eq", "limit", "order", "select"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => ({ data: single ? data : null, error: null });
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
  return query;
}

function rpcChain(data: unknown) {
  const query: Record<string, any> = {};
  query.retry = () => query;
  query.abortSignal = () => query;
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
  return query;
}
