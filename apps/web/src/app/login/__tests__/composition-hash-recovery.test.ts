import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./source-test-loader";

function fixture(recognized: boolean) {
  const id = "00000000-0000-4000-8000-000000000001";
  const original = { tracks: [], clips: [] };
  const source = { document: original, version: 1, documentHash: "legacy" };
  let current = source;
  const writes: Array<{ expectedDocumentHash: string; auditSource: string; patch: { operations: Array<{ document: unknown }> } }> = [];
  const supabase = { from(table: string) {
    const result = () => ({ error: null, data: table === "video_compositions" ? { id, name: "Prueba", material_component_id: id }
      : table === "video_composition_drafts" ? { id, current_version: current.version }
        : table === "material_components" ? { assets: { slides: { editable_deck: {} } } }
          : table === "standalone_assembly_projects" ? null : [] });
    const query = { select: () => query, eq: () => query, neq: () => query,
      maybeSingle: async () => result(), single: async () => result(),
      then: <T>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve) };
    return query;
  } };
  const { initializeHyperframesDraft } = load<{ initializeHyperframesDraft: (params: object) => Promise<{ documentVersion: number }> }>(
    "src/domains/production/hyperframes/hyperframes-draft.service.ts", {
      "../standalone/standalone-html.service": { loadStandaloneHtmlDecks: async () => null },
      "../composition-editor/composition-document.factory": { reconcileCompositionDocument: () => ({ changed: false, document: current.document }) },
      "../composition-editor/composition-document.service": { CompositionDocumentError: class extends Error {}, getCurrentCompositionDocument: async () => current, hashCompositionDocument: () => "canonical",
        applyAndAppendCompositionDocumentPatches: async (input: typeof writes[number]) => { writes.push(input); current = { ...source, documentHash: "canonical", version: 2 }; return current; } },
      "../composition-editor/composition-document-legacy-hash.server": { matchesLegacyNarrativeUndefinedHash: () => recognized },
      "../composition-editor/composition-duration.service": {}, "./hyperframes-plan.service": {},
      "../composition-editor/composition-narrative-source.service": { buildCompositionNarrativeScenes: () => [], buildSceneVisualCatalog: () => [] },
      "../slides/generation/course-deck-editorial-reader.server": {}, "../composition-editor/composition-generated-deck-import.server": {},
      "./hyperframes-source-asset.service": { extractHyperframesAnimatedDeck: () => null, isAutomaticTimelineSourceAsset: () => false, listHyperframesSourceAssets: async () => [] },
      "../composition-editor/composition-deck-image-aliases.server": { compositionDeckImageAssetIds: () => [] },
      "./hyperframes-generated-image-links.server": { ensureGeneratedDeckDraftImageLinks: async () => {} },
    });
  return { source, writes, initialize: () => initializeHyperframesDraft({ compositionId: id, organizationId: id, userId: id, supabase }) };
}

test("la recuperación reconocida crea una única versión mediante CAS y conserva la anterior", async () => {
  const f = fixture(true);
  assert.equal((await f.initialize()).documentVersion, 2);
  assert.equal((await f.initialize()).documentVersion, 2);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].expectedDocumentHash, "legacy"); assert.equal(f.writes[0].auditSource, "SYSTEM");
  assert.equal(f.writes[0].patch.operations[0].document, f.source.document);
  assert.equal(f.source.version, 1); assert.equal(f.source.documentHash, "legacy");
});

test("una identidad no explicada por el defecto conocido se rechaza sin escribir", async () => {
  const f = fixture(false);
  await assert.rejects(f.initialize(), /integridad/);
  assert.equal(f.writes.length, 0);
});
