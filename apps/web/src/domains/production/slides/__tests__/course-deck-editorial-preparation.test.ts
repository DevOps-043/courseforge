import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { prepareGeneratedCourseDeckEditorial, storeGeneratedCourseDeckEditorial } from "../generation/course-deck-editorial-preparation.server";

const organizationId = "00000000-0000-4000-8000-000000000021";
const componentId = "00000000-0000-4000-8000-000000000022";
const imageId = "00000000-0000-4000-8000-000000000023";
function fixture(withImage = false) {
  const deck = buildCourseDeckSpecFromComponent({ artifactId: "editorial-storage-fixture",
    component: { id: componentId, type: "VIDEO_THEORETICAL", content: {},
      sourcePack: { items: [], sourceRefs: [], insights: [] } }, input: { locale: "es", template: "course-module" } });
  if (withImage) {
    deck.slides[0].renderHints = { layout: "split" };
    deck.slides[0].visualAssets = { background: null, supporting: { id: "slot-one", status: "READY",
      url: "https://example.invalid/resource.png", purpose: "supporting", altText: "Ejemplo", prompt: "example",
      promptHash: "a".repeat(64), reason: "educational", sourceRefs: [], storagePath: "production-assets/image.png", checksum: "a".repeat(64),
      slot: { id: "supporting", placement: "image_pane", purpose: "supporting" } } };
  }
  return deck;
}

function fakeClient(rows: unknown[] = [], options: { queryError?: boolean; uploadError?: boolean } = {}) {
  const filters: Array<[string, unknown]> = [];
  const uploads: Array<{ path: string; bytes: Buffer }> = [];
  const query = { select: () => query, eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
    neq: () => query, in: () => query, limit: async () => ({ data: rows, error: options.queryError ? {} : null }) };
  const client = { from: () => query, storage: { from: (bucket: string) => {
    assert.equal(bucket, "production-assets");
    return { upload: async (path: string, bytes: Buffer) => {
      uploads.push({ path, bytes }); return { error: options.uploadError ? {} : null };
    } };
  } } } as unknown as SupabaseClient;
  return { client, filters, uploads };
}
const row = { id: imageId, storage_path: "production-assets/image.png", checksum: "a".repeat(64), metadata: { slide_asset_id: "slot-one" } };

describe("generated editorial server preparation and storage", () => {
  it("uses exact tenant/component/image identity and never treats the URL as a grant", async () => {
    const fake = fakeClient([row]);
    const artifact = await prepareGeneratedCourseDeckEditorial({ deck: fixture(true), organizationId, componentId, supabase: fake.client });
    assert.ok(fake.filters.some(([key, value]) => key === "organization_id" && value === organizationId));
    assert.ok(fake.filters.some(([key, value]) => key === "material_component_id" && value === componentId));
    assert.deepEqual(artifact.fragments[0].usedAssetIds, [imageId]);
    assert.equal(fake.uploads.length, 0);
  });
  for (const [name, rows] of [
    ["missing registry record", []], ["wrong checksum", [{ ...row, checksum: "b".repeat(64) }]],
    ["wrong path", [{ ...row, storage_path: "production-assets/other.png" }]],
    ["ambiguous registry records", [row, { ...row, id: "00000000-0000-4000-8000-000000000024" }]],
  ] as const) {
    it(`rejects ${name} before any upload`, async () => {
      const fake = fakeClient([...rows]);
      await assert.rejects(storeGeneratedCourseDeckEditorial({ deck: fixture(true), organizationId, componentId, supabase: fake.client }),
        /IMAGE_BINDING_MISSING/);
      assert.equal(fake.uploads.length, 0);
    });
  }
  it("does not upload after a registry read failure", async () => {
    const fake = fakeClient([], { queryError: true });
    await assert.rejects(storeGeneratedCourseDeckEditorial({ deck: fixture(true), organizationId, componentId, supabase: fake.client }), /IMAGE_BINDING_MISSING/);
    assert.equal(fake.uploads.length, 0);
  });
  it("writes deterministic content-addressed preparation, not a catalog or revision", async () => {
    const fake = fakeClient();
    const params = { deck: fixture(), organizationId, componentId, supabase: fake.client };
    const first = await storeGeneratedCourseDeckEditorial(params);
    const second = await storeGeneratedCourseDeckEditorial(params);
    assert.deepEqual(first, second);
    assert.equal(fake.uploads[0].path, fake.uploads[1].path);
    assert.match(first.storage_path, new RegExp(`${first.sha256}\\.json$`));
    assert.equal(first.activation, "REQUIRES_AUTHORIZED_DRAFT_REGISTRATION");
    assert.ok(first.field_count > 0);
    const stored = JSON.parse(fake.uploads[0].bytes.toString("utf8"));
    assert.equal(stored.preparation, "COMPILER_VALIDATED");
    assert.equal(stored.fragments[0].template.sourceSha256.length, 64);
    assert.equal("authoritativeAnchor" in stored, false);
    params.deck.appearance = "dark";
    const dark = await storeGeneratedCourseDeckEditorial(params);
    assert.notEqual(first.storage_path, dark.storage_path);
    assert.notEqual(first.source_spec_sha256, dark.source_spec_sha256);
  });
  it("reports storage failure without exposing a provider message", async () => {
    const fake = fakeClient([], { uploadError: true });
    await assert.rejects(storeGeneratedCourseDeckEditorial({ deck: fixture(), organizationId, componentId, supabase: fake.client }),
      /^Error: COURSE_DECK_EDITORIAL_STORAGE_UNAVAILABLE$/);
  });
  it("rejects mismatched component identity before reading or writing", async () => {
    const fake = fakeClient();
    const deck = fixture();
    deck.materialComponentId = "other-component";
    await assert.rejects(storeGeneratedCourseDeckEditorial({ deck, organizationId, componentId, supabase: fake.client }), /IMAGE_BINDING_MISSING/);
    assert.equal(fake.filters.length, 0);
    assert.equal(fake.uploads.length, 0);
  });
});
