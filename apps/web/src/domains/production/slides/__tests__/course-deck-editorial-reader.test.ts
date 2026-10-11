import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGeneratedCourseDeckEditorial } from "../generation/course-deck-editorial-reader.server";
import { generatedDeckIntegrationFixture } from "./generated-deck-integration-fixture";

describe("generated deck independently trusted reader", () => {
  it("reconstructs exact output from saved tenant-owned spec and current image registry without fetching Storage or URLs", async () => {
    const fixture = generatedDeckIntegrationFixture(true);
    const result = await readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client });
    assert.deepEqual(result!.artifact, fixture.artifact);
    assert.ok(fixture.filters.some(filter => filter.column === "material_lessons.materials.artifacts.organization_id" && filter.value === fixture.organizationId));
    assert.ok(fixture.filters.some(filter => filter.table === "production_assets" && filter.column === "organization_id" && filter.value === fixture.organizationId));
    const first = result!.instance("deck-slide-1", fixture.artifact.fragments[0].index);
    assert.notEqual(first.html, fixture.artifact.fragments[0].html);
    assert.deepEqual(first.usedAssetIds, [fixture.imageId]);
    assert.equal(result!.instance("deck-slide-1", first.index), first);
  });
  it("leaves old material explicitly outside automatic adoption", async () => {
    const fixture = generatedDeckIntegrationFixture();
    delete fixture.state.component!.assets.slides.editable_deck;
    assert.equal(await readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }), null);
  });
  for (const tamper of ["tenant", "spec", "hash", "path", "count", "version", "component", "image"] as const) {
    it(`rejects ${tamper} mismatches without a permissive legacy fallback`, async () => {
      const fixture = generatedDeckIntegrationFixture(true);
      if (tamper === "tenant") fixture.component.material_lessons.materials.artifacts.organization_id = fixture.imageId;
      if (tamper === "spec") fixture.deck.slides[0].title = "Contenido cambiado";
      if (tamper === "hash") fixture.reference.sha256 = "f".repeat(64);
      if (tamper === "path") fixture.reference.storage_path = "production-assets/../foreign.json";
      if (tamper === "count") fixture.reference.field_count++;
      if (tamper === "version") fixture.component.assets.slides.editable_deck.format = "unknown-version";
      if (tamper === "component") fixture.deck.materialComponentId = fixture.imageId;
      if (tamper === "image") fixture.state.imageRows = [];
      await assert.rejects(readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }), /GENERATED_DECK_/);
    });
  }
  it("bounds spec parsing and sanitizes read failures", async () => {
    const fixture = generatedDeckIntegrationFixture();
    fixture.state.component!.assets.slides.prepared_spec = { excessive: "x".repeat(1024 * 1024) };
    await assert.rejects(readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }), /INTEGRITY_MISMATCH/);
    fixture.state.error = true;
    await assert.rejects(readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client }), /^GeneratedDeckReadError: GENERATED_DECK_UNAVAILABLE$/);
  });
  it("does no I/O when cancelled before authorization", async () => {
    const fixture = generatedDeckIntegrationFixture();
    const controller = new AbortController(); controller.abort();
    await assert.rejects(readGeneratedCourseDeckEditorial({ ...fixture, supabase: fixture.client, signal: controller.signal }));
    assert.equal(fixture.filters.length, 0);
  });
});
