import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { buildCourseDeckEditableArtifact } from "../render/course-deck-editable-artifact.server";
import type { CourseDeckSpec } from "../specs/course-deck.schema";

export const generatedDeckFixtureIds = { organizationId: "00000000-0000-4000-8000-000000000021",
  componentId: "00000000-0000-4000-8000-000000000022", imageId: "00000000-0000-4000-8000-000000000023",
  draftId: "00000000-0000-4000-8000-000000000024", compositionId: "00000000-0000-4000-8000-000000000025" };
type FixtureComponent = { id: string; assets: { slides: Record<string, unknown> };
  material_lessons: { materials: { artifacts: { organization_id: string } } } };

export function generatedDeckIntegrationFixture(withImage = false, font?: NonNullable<CourseDeckSpec["designSystem"]["font"]>) {
  const ids = generatedDeckFixtureIds;
  const deck = buildCourseDeckSpecFromComponent({ artifactId: "editorial-integration-fixture",
    component: { id: ids.componentId, type: "VIDEO_THEORETICAL", content: {},
      sourcePack: { items: [], sourceRefs: [], insights: [] } }, input: { locale: "es", template: "course-module" } });
  if (withImage) {
    deck.slides[0].renderHints = { layout: "split" };
    deck.slides[0].visualAssets = { background: null, supporting: { id: "slot-one", status: "READY",
      url: "https://example.invalid/resource.png", purpose: "supporting", altText: "Ejemplo", prompt: "example",
      promptHash: "a".repeat(64), reason: "educational", sourceRefs: [], storagePath: "production-assets/image.png", checksum: "a".repeat(64),
      slot: { id: "supporting", placement: "image_pane", purpose: "supporting" } } };
  }
  if (font) deck.designSystem.font = font;
  const artifact = buildCourseDeckEditableArtifact(deck, new Map([["slot-one", ids.imageId]]));
  const sha256 = createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
  const reference = { format: artifact.format, sha256, source_spec_sha256: artifact.sourceSpecSha256,
    storage_path: `production-assets/slides/${ids.componentId}-soflia-engine-deck.editable-${sha256}.json`,
    slide_count: artifact.fragments.length, field_count: artifact.fragments.reduce((count, fragment) => count + fragment.template.elements.length, 0),
    activation: artifact.activation };
  const component = { id: ids.componentId, assets: { slides: { prepared_spec: deck, editable_deck: reference } },
    material_lessons: { materials: { artifacts: { organization_id: ids.organizationId } } } };
  const state = { component: component as FixtureComponent | null, error: false, fontRows: [] as Record<string, unknown>[], imageRows: withImage ? [{
    id: ids.imageId, storage_path: "production-assets/image.png", checksum: "a".repeat(64), metadata: { slide_asset_id: "slot-one" },
  }] : [] };
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const client = { from: (table: string) => {
    const result = () => ({ error: state.error ? { message: "PRIVATE_PROVIDER_DETAIL" } : null,
      data: table === "material_components" ? state.component : table === "video_composition_drafts" ? { composition_id: ids.compositionId }
        : table === "video_compositions" ? { material_component_id: ids.componentId }
          : table === "organization_slide_fonts" ? state.fontRows : state.imageRows });
    const query = { select: () => query, eq: (column: string, value: unknown) => { filters.push({ table, column, value }); return query; },
      neq: () => query, in: () => query, abortSignal: (signal: AbortSignal) => { signal.throwIfAborted(); return query; },
      maybeSingle: async () => result(), limit: () => query,
      then: <T>(resolve: (value: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve) };
    return query;
  } } as unknown as SupabaseClient;
  return { ...ids, deck, artifact, reference, component, state, filters, client };
}
