import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  applyAndAppendCompositionDocumentPatches,
  getCurrentCompositionDocument,
  normalizeCompositionPersistenceError,
} from "../composition-document.service";
import { normalizeCompositionDocumentLayerDepths } from "../composition-layer-depth";
import { readReadyLinkedSoundEffectAssetIds } from "../composition-sound-effect-assets.service";
import { getCompositionTrackDefinition } from "../composition-track-registry";

const DRAFT_ID = "f7d8853b-49cb-4a46-acd9-2c21696686c3";
const ORGANIZATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const READY_EFFECT_ID = "11111111-1111-4111-8111-111111111111";
const NOT_READY_EFFECT_ID = "22222222-2222-4222-8222-222222222222";

test("normalizes legacy layer depths into the 0 to 10 contract", () => {
  const normalized = normalizeCompositionDocumentLayerDepths({
    clips: [
      { id: "behind", layout: { zIndex: -25 } },
      { id: "ahead", layout: { zIndex: 250 } },
    ],
  }) as { clips: Array<{ layout: { zIndex: number } }> };

  assert.deepEqual(normalized.clips.map((clip) => clip.layout.zIndex), [0, 10]);
});

test("uses the stored document hash as the concurrency token", async () => {
  const storedHash = "a".repeat(64);
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }",
      fonts: [],
      height: 1080,
      slides: [
        {
          animationCount: 0,
          classes: "slide",
          html: "<section>Slide</section>",
          index: 0,
          label: "Introducción",
        },
      ],
      width: 1920,
    },
    assets: [],
    plan: {
      accentColor: "#38BDF8",
      durationSeconds: 5,
      subtitle: "Prueba",
      title: "Video de prueba",
    },
  });
  const documentQuery = {
    eq: () => documentQuery,
    limit: () => documentQuery,
    maybeSingle: async () => ({ data: { document, document_hash: storedHash, version: 1 }, error: null }),
    order: () => documentQuery,
    select: () => documentQuery,
  };
  const assetLinksQuery = {
    eq: () => assetLinksQuery,
    select: () => assetLinksQuery,
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  };
  const supabase = { from: (table: string) => table === "video_composition_draft_assets" ? assetLinksQuery : documentQuery };

  const current = await getCurrentCompositionDocument({
    draftId: "f7d8853b-49cb-4a46-acd9-2c21696686c3",
    organizationId: "550e8400-e29b-41d4-a716-446655440000",
    supabase: supabase as never,
  });

  assert.equal(current.documentHash, storedHash);
  assert.equal(current.version, 1);
});

test("appends the complete accumulated document when saving a new version", async () => {
  const storedHash = "a".repeat(64);
  const nextHash = "b".repeat(64);
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 0, classes: "slide", html: "<section>Slide</section>", index: 0, label: "Introducción" }],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Persistencia" },
  });
  const clip = document.clips[0]!;
  document.canvas.durationSeconds = 12;
  Object.assign(clip, {
    durationSeconds: 6.5,
    hidden: true,
    startSeconds: 1.25,
    timingSource: "USER_EDITED" as const,
  });
  Object.assign(clip.layout, { height: 640, opacity: 0.8, width: 1138, x: 301, y: 172, zIndex: 9 });
  document.tracks[0]!.hidden = true;

  const documentQuery = {
    eq: () => documentQuery,
    limit: () => documentQuery,
    maybeSingle: async () => ({ data: { document, document_hash: storedHash, version: 4 }, error: null }),
    order: () => documentQuery,
    select: () => documentQuery,
  };
  const assetLinksQuery = {
    eq: () => assetLinksQuery,
    select: () => assetLinksQuery,
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  };
  const rpcCapture: { document?: typeof document } = {};
  const supabase = {
    from: (table: string) => table === "video_composition_draft_assets" ? assetLinksQuery : documentQuery,
    rpc: (_name: string, params: { p_document: typeof document }) => {
      rpcCapture.document = params.p_document;
      return { retry: () => ({ data: [{ document_hash: nextHash, outcome: "APPENDED", version: 5 }], error: null }) };
    },
  };

  const saved = await applyAndAppendCompositionDocumentPatches({
    draftId: "f7d8853b-49cb-4a46-acd9-2c21696686c3",
    expectedDocumentHash: storedHash,
    organizationId: "550e8400-e29b-41d4-a716-446655440000",
    patch: {
      operations: [{ clipId: clip.id, layout: { rotation: 27 }, type: "clip.layout" }],
      source: "USER",
      summary: "Rotó el elemento seleccionado.",
    },
    supabase: supabase as never,
    userId: "00000000-0000-4000-8000-000000000001",
  });

  const appendedDocument = rpcCapture.document;
  assert.ok(appendedDocument);
  const stored = appendedDocument.clips.find((candidate) => candidate.id === clip.id)!;
  assert.equal(stored.startSeconds, 1.25);
  assert.equal(stored.durationSeconds, 6.5);
  assert.equal(stored.hidden, true);
  assert.deepEqual(stored.layout, {
    height: 640,
    opacity: 0.8,
    rotation: 27,
    width: 1138,
    x: 301,
    y: 172,
    zIndex: 9,
  });
  assert.equal(appendedDocument.tracks[0]?.hidden, true);
  assert.equal(saved.documentHash, nextHash);
  assert.equal(saved.version, 5);
});

test("allows trusted system reconciliation to add a clip without weakening the agent policy", async () => {
  const storedHash = "a".repeat(64);
  const nextHash = "b".repeat(64);
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: "",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 0, classes: "slide", html: "<section>Base</section>", index: 0, label: "Base" }],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Sistema" },
  });
  const addedClip = {
    ...document.clips[0]!,
    hfId: "deck-slide-system",
    id: "deck-slide-system",
    label: "Añadido por reconciliación",
  };
  const documentQuery = {
    eq: () => documentQuery,
    limit: () => documentQuery,
    maybeSingle: async () => ({ data: { document, document_hash: storedHash, version: 1 }, error: null }),
    order: () => documentQuery,
    select: () => documentQuery,
  };
  const assetLinksQuery = {
    eq: () => assetLinksQuery,
    select: () => assetLinksQuery,
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  };
  const supabase = {
    from: (table: string) => table === "video_composition_draft_assets" ? assetLinksQuery : documentQuery,
    rpc: () => ({ retry: () => ({ data: [{ document_hash: nextHash, outcome: "APPENDED", version: 2 }], error: null }) }),
  };

  const saved = await applyAndAppendCompositionDocumentPatches({
    auditSource: "SYSTEM",
    draftId: "f7d8853b-49cb-4a46-acd9-2c21696686c3",
    expectedDocumentHash: storedHash,
    organizationId: "550e8400-e29b-41d4-a716-446655440000",
    patch: {
      operations: [{ clip: addedClip, clipId: addedClip.id, type: "clip.add" }],
      source: "AGENT",
      summary: "Sincronizó un asset desde Producción.",
    },
    supabase: supabase as never,
    userId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(saved.document.clips.some((clip) => clip.id === addedClip.id), true);
  assert.equal(saved.version, 2);
});

test("appends a linked READY sound effect without relying on an embedded PostgREST relation", async () => {
  const storedHash = "a".repeat(64);
  const nextHash = "b".repeat(64);
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: "",
      fonts: [],
      height: 1080,
      slides: [{ animationCount: 0, classes: "slide", html: "<section>Base</section>", index: 0, label: "Base" }],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "SFX" },
  });
  const documentQuery = {
    eq: () => documentQuery,
    limit: () => documentQuery,
    maybeSingle: async () => ({ data: { document, document_hash: storedHash, version: 1 }, error: null }),
    order: () => documentQuery,
    select: () => documentQuery,
  };
  const query = (data: unknown) => {
    const builder = {
      eq: () => builder,
      in: () => builder,
      select: () => builder,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data, error: null })),
    };
    return builder;
  };
  const supabase = {
    from: (table: string) => {
      if (table === "video_composition_draft_sound_effect_assets") {
        return query([{ sound_effect_asset_id: READY_EFFECT_ID }]);
      }
      if (table === "sound_effect_assets") return query([{ id: READY_EFFECT_ID }]);
      return documentQuery;
    },
    rpc: () => ({ retry: () => ({ data: [{ document_hash: nextHash, outcome: "APPENDED", version: 2 }], error: null }) }),
  };
  const track = getCompositionTrackDefinition("SFX");
  const clip = {
    durationSeconds: 1,
    hidden: false,
    hfId: "sfx-ready",
    id: "sfx-ready",
    kind: "AUDIO" as const,
    label: "Whoosh",
    layout: { height: 1, opacity: 1, rotation: 0, width: 1, x: 0, y: 0, zIndex: 0 },
    source: { soundEffectAssetId: READY_EFFECT_ID, type: "SOUND_EFFECT_ASSET" as const },
    sourceDurationSeconds: 1,
    sourceOffsetSeconds: 0,
    startSeconds: 1,
    timingSource: "USER_EDITED" as const,
    trackId: track.id,
    volume: 0.7,
  };

  const saved = await applyAndAppendCompositionDocumentPatches({
    draftId: DRAFT_ID,
    expectedDocumentHash: storedHash,
    organizationId: ORGANIZATION_ID,
    patch: {
      operations: [{ clip, clipId: clip.id, track, type: "clip.add" }],
      source: "USER",
      summary: "Añadió un efecto de transición.",
    },
    supabase: supabase as never,
    userId: "00000000-0000-4000-8000-000000000001",
  });

  assert.equal(saved.version, 2);
  assert.equal(saved.document.clips.some((candidate) => candidate.id === clip.id), true);
  assert.equal(saved.document.tracks.some((candidate) => candidate.semanticRole === "SFX"), true);
});

test("classifies statement cancellation as a retryable save timeout", () => {
  const error = normalizeCompositionPersistenceError(
    { code: "57014", message: "canceling statement due to statement timeout" },
    "diagnostic-1",
  );

  assert.equal(error.code, "COMPOSITION_SAVE_TIMEOUT");
  assert.equal(error.status, 503);
  assert.equal(error.retryable, true);
  assert.equal(error.diagnosticId, "diagnostic-1");
});

test("classifies an upstream gateway timeout as temporary storage unavailability", () => {
  const error = normalizeCompositionPersistenceError(
    { message: "upstream request timeout" },
    "diagnostic-upstream",
  );

  assert.equal(error.code, "COMPOSITION_STORAGE_UNAVAILABLE");
  assert.equal(error.status, 503);
  assert.equal(error.retryable, true);
  assert.equal(error.diagnosticId, "diagnostic-upstream");
});

test("keeps an unknown persistence failure generic while preserving correlation", () => {
  const error = normalizeCompositionPersistenceError(
    { code: "XX000", message: "internal error" },
    "diagnostic-2",
  );

  assert.equal(error.code, "COMPOSITION_PERSISTENCE_FAILED");
  assert.equal(error.status, 500);
  assert.equal(error.retryable, true);
  assert.equal(error.diagnosticId, "diagnostic-2");
});

test("authorizes only draft-linked READY sound effects without embedded-relation cardinality assumptions", async () => {
  const supabase = createSoundEffectLookupClient({
    assets: [{ id: READY_EFFECT_ID }],
    links: [
      { sound_effect_asset_id: READY_EFFECT_ID },
      { sound_effect_asset_id: NOT_READY_EFFECT_ID },
    ],
  });

  const ids = await readReadyLinkedSoundEffectAssetIds({
    draftId: DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    soundEffectAssetIds: [READY_EFFECT_ID, NOT_READY_EFFECT_ID, READY_EFFECT_ID],
    supabase: supabase as never,
  });

  assert.deepEqual([...ids], [READY_EFFECT_ID]);
  assert.deepEqual(supabase.requestedTables, [
    "video_composition_draft_sound_effect_assets",
    "sound_effect_assets",
  ]);
});

test("fails closed when a linked sound effect is not READY", async () => {
  const supabase = createSoundEffectLookupClient({
    assets: [],
    links: [{ sound_effect_asset_id: NOT_READY_EFFECT_ID }],
  });

  const ids = await readReadyLinkedSoundEffectAssetIds({
    draftId: DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    soundEffectAssetIds: [NOT_READY_EFFECT_ID],
    supabase: supabase as never,
  });

  assert.equal(ids.size, 0);
});

test("propagates a sound-effect lookup failure instead of authorizing an unknown asset", async () => {
  const databaseError = { code: "PGRST003", message: "pool timeout" };
  const supabase = createSoundEffectLookupClient({
    assets: [],
    assetsError: databaseError,
    links: [{ sound_effect_asset_id: READY_EFFECT_ID }],
  });

  await assert.rejects(
    readReadyLinkedSoundEffectAssetIds({
      draftId: DRAFT_ID,
      organizationId: ORGANIZATION_ID,
      soundEffectAssetIds: [READY_EFFECT_ID],
      supabase: supabase as never,
    }),
    (error) => error === databaseError,
  );
});

function createSoundEffectLookupClient(input: {
  assets: Array<{ id: string }>;
  assetsError?: unknown;
  links: Array<{ sound_effect_asset_id: string }>;
  linksError?: unknown;
}) {
  const requestedTables: string[] = [];
  return {
    from(table: string) {
      requestedTables.push(table);
      const result = table === "sound_effect_assets"
        ? { data: input.assets, error: input.assetsError || null }
        : { data: input.links, error: input.linksError || null };
      const query = {
        eq: () => query,
        in: () => query,
        select: () => query,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
      };
      return query;
    },
    requestedTables,
  };
}
