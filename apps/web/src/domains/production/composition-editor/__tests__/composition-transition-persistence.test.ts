import assert from "node:assert/strict";
import test from "node:test";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import {
  applyAndAppendCompositionDocumentPatches,
  getCurrentCompositionDocument,
  hashCompositionDocument,
} from "../composition-document.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { activateCompositionSnapshot } from "../composition-snapshot.service";
import { createTransition, createTransitionDocument } from "./composition-transition-test-fixtures";

const DRAFT_ID = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_ID = "20000000-0000-4000-8000-000000000001";
const USER_ID = "30000000-0000-4000-8000-000000000001";

test("round-trip JSON conserva transiciones y documentos anteriores siguen sin necesitarlas", () => {
  const plain = createTransitionDocument();
  const transitioned = applyCompositionEditorPatches(plain, [{
    transition: createTransition(plain),
    type: "transition.add",
  }]);

  const parsedPlain = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(plain)));
  const parsedTransitioned = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(transitioned)));

  assert.deepEqual(parsedPlain.transitions, { items: [], schemaVersion: 1 });
  assert.deepEqual(parsedTransitioned.transitions, transitioned.transitions);
  assert.equal(hashCompositionDocument(parsedTransitioned), hashCompositionDocument(transitioned));
  assert.notEqual(hashCompositionDocument(parsedTransitioned), hashCompositionDocument(parsedPlain));
});

test("guardar y recargar conserva la transición y registra metadata de auditoría", async () => {
  const document = createTransitionDocument();
  const storedHash = hashCompositionDocument(document);
  const documentQuery = createDocumentQuery(document, storedHash, 1);
  const assetLinksQuery = createEmptyQuery();
  let appendedDocument: typeof document | undefined;
  let appendedMetadata: Record<string, unknown> | undefined;
  const saveClient = {
    from: (table: string) => table === "video_composition_draft_assets" ? assetLinksQuery : documentQuery,
    rpc: (_name: string, params: { p_document: typeof document; p_metadata: Record<string, unknown> }) => {
      appendedDocument = structuredClone(params.p_document);
      appendedMetadata = params.p_metadata;
      return {
        retry: () => ({
          data: [{ document_hash: hashCompositionDocument(params.p_document), outcome: "APPENDED", version: 2 }],
          error: null,
        }),
      };
    },
  };

  const transition = createTransition(document);
  const saved = await applyAndAppendCompositionDocumentPatches({
    draftId: DRAFT_ID,
    expectedDocumentHash: storedHash,
    organizationId: ORGANIZATION_ID,
    patch: {
      operations: [{ transition, type: "transition.add" }],
      source: "USER",
      summary: "Añadió una transición real.",
    },
    supabase: saveClient as never,
    userId: USER_ID,
  });

  assert.deepEqual(saved.document.transitions?.items, [transition]);
  assert.deepEqual(appendedDocument?.transitions, saved.document.transitions);
  assert.equal(appendedMetadata?.transitionCount, 1);
  assert.deepEqual(appendedMetadata?.operations, ["transition.add"]);

  const reloadClient = {
    from: (table: string) => table === "video_composition_draft_assets"
      ? assetLinksQuery
      : createDocumentQuery(appendedDocument!, saved.documentHash, saved.version),
  };
  const reloaded = await getCurrentCompositionDocument({
    draftId: DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    supabase: reloadClient as never,
  });

  assert.deepEqual(reloaded.document.transitions, saved.document.transitions);
  assert.equal(reloaded.documentHash, saved.documentHash);
  assert.equal(reloaded.version, 2);
});

test("document.restore recupera exactamente la versión con o sin transición", () => {
  const plain = createTransitionDocument();
  const transitioned = applyCompositionEditorPatches(plain, [{
    transition: createTransition(plain),
    type: "transition.add",
  }]);

  const restoredTransitioned = applyCompositionEditorPatches(plain, [{ document: transitioned, type: "document.restore" }]);
  const restoredPlain = applyCompositionEditorPatches(transitioned, [{ document: plain, type: "document.restore" }]);

  assert.deepEqual(restoredTransitioned.transitions, transitioned.transitions);
  assert.notEqual(restoredTransitioned.transitions, transitioned.transitions);
  assert.deepEqual(restoredPlain.transitions, plain.transitions);
});

test("restaurar un snapshot recupera la transición aprobada sin mutar su relación", async () => {
  const base = createTransitionDocument();
  const document = applyCompositionEditorPatches(base, [{
    transition: createTransition(base),
    type: "transition.add",
  }]);
  const documentHash = hashCompositionDocument(document);
  const revisionId = "50000000-0000-4000-8000-000000000001";
  const revisionQuery = createRevisionQuery({
    created_at: "2026-09-17T18:00:00.000Z",
    id: revisionId,
    manifest: {
      draft_document_hash: documentHash,
      draft_document_version: 4,
      render_profile: { format: "mp4", fps: 25, quality: "standard", resolution: "1080p" },
      snapshot: true,
    },
    project_archive_size_bytes: 4096,
    revision_number: 3,
  });
  const supabase = {
    from: () => revisionQuery,
    rpc: () => createRpcQuery([{
      document,
      document_hash: documentHash,
      outcome: "RESTORED",
      version: 9,
    }]),
  };

  const restored = await activateCompositionSnapshot({
    compositionId: "60000000-0000-4000-8000-000000000001",
    draftId: DRAFT_ID,
    expectedDocumentHash: "a".repeat(64),
    organizationId: ORGANIZATION_ID,
    revisionId,
    supabase: supabase as never,
    userId: USER_ID,
  });

  assert.deepEqual(restored.document.transitions, document.transitions);
  assert.notEqual(restored.document.transitions, document.transitions);
  assert.equal(restored.documentHash, documentHash);
  assert.equal(restored.status, "READY_FOR_PREVIEW");
});

function createDocumentQuery(document: unknown, documentHash: string, version: number) {
  const query: Record<string, unknown> = {};
  for (const method of ["eq", "limit", "order", "select"]) {
    query[method] = () => query;
  }
  query.maybeSingle = async () => ({ data: { document, document_hash: documentHash, version }, error: null });
  return query;
}

function createEmptyQuery() {
  const query: Record<string, unknown> = {};
  query.eq = () => query;
  query.select = () => query;
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null });
  return query;
}

function createRevisionQuery(data: unknown) {
  const query: Record<string, unknown> = {};
  for (const method of ["contains", "eq", "select"]) query[method] = () => query;
  query.maybeSingle = async () => ({ data, error: null });
  return query;
}

function createRpcQuery(data: unknown) {
  const query: Record<string, unknown> = {};
  query.retry = () => query;
  query.abortSignal = () => query;
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data, error: null });
  return query;
}
