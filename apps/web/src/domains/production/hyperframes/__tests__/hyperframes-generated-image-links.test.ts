import assert from "node:assert/strict";
import test from "node:test";
import { generatedDeckIntegrationFixture } from "../../slides/__tests__/generated-deck-integration-fixture";
import { readGeneratedCourseDeckEditorial } from "../../slides/generation/course-deck-editorial-reader.server";
import { createInitialCompositionDocument } from "../../composition-editor/composition-document.factory";
import { generatedDeckInitialSource, instantiateGeneratedDeckDocument } from "../../composition-editor/composition-generated-deck-import.server";
import { ensureGeneratedDeckDraftImageLinks } from "../hyperframes-generated-image-links.server";

async function fixture() {
  const f = generatedDeckIntegrationFixture(true);
  const verified = (await readGeneratedCourseDeckEditorial({ ...f, supabase: f.client }))!;
  const document = instantiateGeneratedDeckDocument(createInitialCompositionDocument({ assets: [],
    animatedDeck: generatedDeckInitialSource(verified), plan: { title: "Prueba", subtitle: "", durationSeconds: 20, accentColor: "#00aabb" } }), verified);
  const links = new Set<string>();
  const writes: Record<string, unknown>[][] = [];
  const filters: Array<[string, unknown]> = [];
  const state = { writeError: false };
  const client = { from(table: string) {
    if (table !== "video_composition_draft_assets") return f.client.from(table);
    const result = () => ({ data: [...links].map(production_asset_id => ({ production_asset_id })), error: null });
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      in: () => query, then: <T>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve),
      upsert: async (rows: Record<string, unknown>[]) => {
        writes.push(rows);
        if (state.writeError) return { error: new Error("write failed") };
        rows.forEach(row => links.add(row.production_asset_id as string)); return { error: null };
      } };
    return query;
  } } as unknown as typeof f.client;
  return { ...f, verified, document, links, writes, filters, linkState: state, input: {
    componentId: f.componentId, document, draftId: f.draftId, organizationId: f.organizationId, supabase: client } };
}

test("recupera una imagen editorial verificada para un borrador existente de forma idempotente", async () => {
  const f = await fixture();
  const before = JSON.stringify(f.document);
  await ensureGeneratedDeckDraftImageLinks(f.input);
  await ensureGeneratedDeckDraftImageLinks(f.input);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0], [{ draft_id: f.draftId, organization_id: f.organizationId,
    production_asset_id: f.imageId, role: "IMAGE", source_reference: "DECK_DEPENDENCY" }]);
  assert.ok(f.filters.some(([key, value]) => key === "organization_id" && value === f.organizationId));
  assert.equal(JSON.stringify(f.document), before, "No modifica la autoría ni crea clips extra");
});

test("el primer documento puede vincular las imágenes desde el mismo artefacto verificado", async () => {
  const f = await fixture();
  await ensureGeneratedDeckDraftImageLinks({ ...f.input, verified: f.verified });
  assert.deepEqual([...f.links], [f.imageId]);
});

for (const tamper of ["alias", "tenant", "registry", "hash", "legacy"] as const) {
  test(`no concede vínculos por ${tamper} sin verificación`, async () => {
    const f = await fixture();
    if (tamper === "alias") {
      const clip = f.document.clips.find(c => c.source.type === "DECK_SLIDE" && c.source.html.includes(f.imageId))!;
      if (clip.source.type === "DECK_SLIDE") clip.source.html = clip.source.html.replaceAll(f.imageId, f.compositionId);
    }
    if (tamper === "tenant") f.component.material_lessons.materials.artifacts.organization_id = f.imageId;
    if (tamper === "registry") f.state.imageRows = [];
    if (tamper === "hash") f.reference.sha256 = "f".repeat(64);
    if (tamper === "legacy") delete f.state.component!.assets.slides.editable_deck;
    await assert.rejects(ensureGeneratedDeckDraftImageLinks(f.input), /GENERATED_DECK_/);
    assert.equal(f.writes.length, 0);
  });
}

test("un error al vincular no acredita una preparación exitosa", async () => {
  const f = await fixture();
  f.linkState.writeError = true;
  await assert.rejects(ensureGeneratedDeckDraftImageLinks(f.input), /write failed/);
  assert.equal(f.links.size, 0);
});
