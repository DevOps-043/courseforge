import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./source-test-loader";

test("inicializar repetidamente conserva el vínculo editorial y limpia el medio obsoleto", async () => {
  const draftId = "00000000-0000-4000-8000-000000000001";
  const organizationId = "00000000-0000-4000-8000-000000000002";
  const links = new Set(["editor-image", "stale-media"]);
  const document = { tracks: [], clips: [] };
  let ensured = 0;
  const supabase = { from(table: string) {
    let deleting = false;
    const result = () => ({ error: null, data: table === "video_compositions" ? { id: "composition", name: "Prueba", material_component_id: "component" }
      : table === "video_composition_drafts" ? { id: draftId, current_version: 1 }
        : table === "material_components" ? { assets: { slides: { editable_deck: {} } } }
          : table === "standalone_assembly_projects" ? null : [...links].map(production_asset_id => ({ production_asset_id })) });
    const query = { select: () => query, eq: () => query, neq: () => query,
      delete: () => { deleting = true; return query; }, in: (_column: string, ids: string[]) => {
        if (deleting) ids.forEach(id => links.delete(id)); return query;
      }, maybeSingle: async () => result(), single: async () => result(),
      then: <T>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve) };
    return query;
  } };
  const { initializeHyperframesDraft } = load<{ initializeHyperframesDraft: (params: object) => Promise<unknown> }>(
    "src/domains/production/hyperframes/hyperframes-draft.service.ts", {
      "../standalone/standalone-html.service": { loadStandaloneHtmlDecks: async () => null },
      "../composition-editor/composition-document.factory": { reconcileCompositionDocument: () => ({ changed: false, document }) },
      "../composition-editor/composition-document.service": { getCurrentCompositionDocument: async () => ({ document, version: 1, documentHash: "canonical" }), hashCompositionDocument: () => "canonical" },
      "../composition-editor/composition-document-legacy-hash.server": {},
      "../composition-editor/composition-duration.service": {}, "./hyperframes-plan.service": {},
      "../composition-editor/composition-narrative-source.service": { buildCompositionNarrativeScenes: () => [], buildSceneVisualCatalog: () => [] },
      "../slides/generation/course-deck-editorial-reader.server": {},
      "../composition-editor/composition-generated-deck-import.server": {},
      "./hyperframes-source-asset.service": { extractHyperframesAnimatedDeck: () => null, isAutomaticTimelineSourceAsset: () => false, listHyperframesSourceAssets: async () => [] },
      "../composition-editor/composition-deck-image-aliases.server": { compositionDeckImageAssetIds: () => ["editor-image"] },
      "./hyperframes-generated-image-links.server": { ensureGeneratedDeckDraftImageLinks: async () => { ensured++; links.add("editor-image"); } },
    });
  const params = { compositionId: "composition", draftId, organizationId, userId: organizationId, supabase };
  await initializeHyperframesDraft(params);
  assert.deepEqual([...links], ["editor-image"]);
  links.clear(); // Estado previo al arreglo: el documento existe, faltan vínculos.
  await initializeHyperframesDraft(params);
  assert.deepEqual([...links], ["editor-image"]);
  assert.equal(ensured, 2);
});
