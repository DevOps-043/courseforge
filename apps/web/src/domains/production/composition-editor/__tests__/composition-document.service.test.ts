import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  applyAndAppendCompositionDocumentPatches,
  getCompositionDocumentByHash,
  getCurrentCompositionDocument,
  hashCompositionDocument,
  normalizeCompositionPersistenceError,
} from "../composition-document.service";
import { normalizeCompositionDocumentLayerDepths } from "../composition-layer-depth";
import { readReadyLinkedSoundEffectAssetIds } from "../composition-sound-effect-assets.service";
import { getCompositionTrackDefinition } from "../composition-track-registry";
import { isUsableCompositionReplacementAsset, replacementAssetStoragePath } from "../composition-replacement-asset";

const DRAFT_ID = "f7d8853b-49cb-4a46-acd9-2c21696686c3";
const ORGANIZATION_ID = "550e8400-e29b-41d4-a716-446655440000";
const READY_EFFECT_ID = "11111111-1111-4111-8111-111111111111";
const NOT_READY_EFFECT_ID = "22222222-2222-4222-8222-222222222222";

test("links verified processed voice and restores the original while protecting paired scenes", async () => {
  const originalId = "33333333-3333-4333-8333-333333333333";
  const processedId = "44444444-4444-4444-8444-444444444444";
  const componentId = "55555555-5555-4555-8555-555555555555";
  let document = createInitialCompositionDocument({ animatedDeck: null, assets: [
    { checksum: "a".repeat(64), durationSeconds: 8, fileSizeBytes: 42, mimeType: "audio/mpeg", productionAssetId: originalId,
      publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/voice.mp3", timelineRole: "VOICE", sceneClipId: "scene-1", sceneOrder: 1 },
    { checksum: "b".repeat(64), durationSeconds: 8, fileSizeBytes: 42, mimeType: "video/mp4", productionAssetId: READY_EFFECT_ID,
      publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/avatar.mp4", timelineRole: "AVATAR", sceneClipId: "scene-1", sceneOrder: 1 },
  ], plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Voz procesada" } });
  const voice = document.clips.find((clip) => clip.kind === "AUDIO")!;
  const linkedIds = new Set([originalId]);
  const original = { id: originalId, asset_type: "SOURCE_MEDIA", provider: "manual", material_component_id: componentId,
    checksum: "a".repeat(64), file_size_bytes: 42, mime_type: "audio/mpeg", duration_milliseconds: 8000, duration_seconds: 8,
    metadata: { has_audio: true }, qa_status: "READY_FOR_QA", storage_bucket: "production-assets", storage_path: "voice.mp3" };
  const processed = { ...original, id: processedId, asset_type: "PROCESSED_AUDIO", provider: "ffmpeg", mime_type: "audio/mp4",
    metadata: { has_audio: true, source_asset_id: originalId, audio_analysis: { passed: true } }, storage_path: "processed.m4a" };
  const query = (response: () => unknown) => {
    const builder = { eq: () => builder, in: () => builder, order: () => builder, limit: () => builder, select: () => builder,
      maybeSingle: async () => response(), then: (resolve: (value: unknown) => unknown) => resolve(response()),
      upsert: async (value: { production_asset_id: string }) => { linkedIds.add(value.production_asset_id); return { error: null }; } };
    return builder;
  };
  const supabase = {
    from: (table: string) => table === "video_composition_draft_assets"
      ? query(() => ({ data: [...linkedIds].map((id) => ({ production_asset_id: id })), error: null }))
      : table === "production_assets" ? query(() => ({ data: [original, processed], error: null }))
        : query(() => ({ data: { document, document_hash: hashCompositionDocument(document), version: 1 }, error: null })),
    storage: { from: () => ({ info: async () => ({ data: { size: 42 }, error: null }) }) },
    rpc: (_name: string, parameters: { p_document: typeof document }) => {
      document = parameters.p_document;
      return { retry: () => ({ data: [{ document_hash: hashCompositionDocument(document), outcome: "APPENDED", version: 2 }], error: null }) };
    },
  };
  const replace = (assetId: string) => applyAndAppendCompositionDocumentPatches({ draftId: DRAFT_ID, expectedDocumentHash: hashCompositionDocument(document),
    organizationId: ORGANIZATION_ID, supabase: supabase as never, userId: READY_EFFECT_ID,
    patch: { source: "USER", summary: "Cambió la voz.", operations: [{ type: "clip.replace-source", clipId: voice.id, productionAssetId: assetId, mimeType: "audio/mp4" }] } });
  await replace(processedId);
  assert.equal(linkedIds.has(processedId), true);
  assert.equal(document.clips.find((clip) => clip.id === voice.id)?.source.type, "PRODUCTION_ASSET");
  await replace(originalId);
  assert.deepEqual(document.clips.find((clip) => clip.id === voice.id)?.source, { ...voice.source, hasAudio: true });
  processed.metadata.audio_analysis.passed = false;
  await assert.rejects(() => replace(processedId), /avatar-voz/);
});

test("reemplazo rechaza medios sin identidad y límites de entrega verificables", () => {
  const asset = {
    checksum: "a".repeat(64),
    file_size_bytes: 42,
    id: "44444444-4444-4444-8444-444444444444",
    metadata: { file_name: "new.mp4", source_width: 1920, source_height: 1080 },
    mime_type: "video/mp4",
    qa_status: "GENERATED",
    storage_bucket: "production-assets",
    storage_path: "production-assets/new.mp4",
  };
  assert.equal(isUsableCompositionReplacementAsset(asset), true);
  assert.equal(replacementAssetStoragePath(asset), "new.mp4");
  assert.equal(replacementAssetStoragePath({ ...asset, storage_path: "nested/new.mp4" }), "nested/new.mp4");
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, checksum: null }), false);
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, file_size_bytes: null }), false);
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, file_size_bytes: 3 * 1024 * 1024 * 1024 }), false);
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, storage_bucket: "private-unknown" }), false);
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, storage_path: "../outside.mp4" }), false);
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, mime_type: "audio/mpeg" }), false);
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, qa_status: "REJECTED" }), false);
  assert.equal(isUsableCompositionReplacementAsset({ ...asset, qa_status: "ARCHIVED" }), false);
});

test("reemplazo exige vínculo al borrador y normaliza metadatos desde el registro", async () => {
  const originalId = "33333333-3333-4333-8333-333333333333";
  const replacementId = "44444444-4444-4444-8444-444444444444";
  const document = createInitialCompositionDocument({
    animatedDeck: { css: "", fonts: [], height: 1080, slides: [{ animationCount: 0, classes: "slide", html: "<section>Uno</section>", index: 0, label: "Uno" }], width: 1920 },
    assets: [{ checksum: "a".repeat(64), durationSeconds: 8, fileSizeBytes: 42, mimeType: "video/mp4", productionAssetId: originalId, publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/old.mp4" }],
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Reemplazo" },
  });
  const clip = document.clips.find((candidate) => candidate.kind === "VIDEO")!;
  clip.durationSeconds = 4;
  const storedHash = "a".repeat(64);
  let linked = false;
  let savedDocument: typeof document | undefined;
  let appendCount = 0;
  let storageStatus: "AVAILABLE" | "MISSING" | "UNAVAILABLE" | "SIZE_MISMATCH" | "THROW" = "AVAILABLE";
  const checkedStoragePaths: string[] = [];
  const replacementRecord = { id: replacementId, checksum: "b".repeat(64) as string | null, file_size_bytes: 42, mime_type: "video/mp4", duration_milliseconds: 8000, duration_seconds: 8, metadata: { has_audio: true, source_width: 1920, source_height: 1080 }, qa_status: "GENERATED", storage_bucket: "production-assets", storage_path: "production-assets/new.mp4" };
  const query = (response: () => unknown) => {
    const builder = {
      eq: () => builder,
      in: () => builder,
      limit: () => builder,
      order: () => builder,
      select: () => builder,
      maybeSingle: async () => response(),
      then: (resolve: (value: unknown) => unknown) => resolve(response()),
    };
    return builder;
  };
  const supabase = {
    storage: {
      from: (bucket: string) => ({
        info: async (path: string) => {
          checkedStoragePaths.push(`${bucket}/${path}`);
          if (storageStatus === "THROW") throw new Error("storage transport failed");
          if (storageStatus === "MISSING") return { data: null, error: { status: 404 } };
          if (storageStatus === "UNAVAILABLE") return { data: null, error: { status: 503 } };
          return { data: { size: storageStatus === "SIZE_MISMATCH" ? 43 : 42 }, error: null };
        },
      }),
    },
    from: (table: string) => table === "video_composition_draft_assets"
      ? query(() => ({ data: linked ? [{ production_asset_id: replacementId }] : [], error: null }))
      : table === "production_assets"
        ? query(() => ({ data: [replacementRecord], error: null }))
        : query(() => ({ data: { document, document_hash: storedHash, version: 1 }, error: null })),
    rpc: (_name: string, params: { p_document: typeof document }) => {
      appendCount += 1;
      savedDocument = params.p_document;
      return { retry: () => ({ data: [{ document_hash: "b".repeat(64), outcome: "APPENDED", version: 2 }], error: null }) };
    },
  };
  const patch = {
    operations: [{ clipId: clip.id, productionAssetId: replacementId, mimeType: "audio/mpeg", sourceDurationSeconds: 3600,
      audioProcessingPreviousAssetId: originalId, type: "clip.replace-source" as const }],
    source: "USER" as const,
    summary: "Reemplazó el medio del clip.",
  };
  const params = { draftId: DRAFT_ID, expectedDocumentHash: storedHash, organizationId: ORGANIZATION_ID, patch, supabase: supabase as never, userId: "00000000-0000-4000-8000-000000000001" };
  await assert.rejects(() => applyAndAppendCompositionDocumentPatches(params), /no está vinculado/);
  linked = true;
  await applyAndAppendCompositionDocumentPatches(params);
  const source = savedDocument?.clips.find((candidate) => candidate.id === clip.id)?.source;
  assert.equal(source?.type, "PRODUCTION_ASSET");
  if (source?.type === "PRODUCTION_ASSET") {
    assert.equal(source.productionAssetId, replacementId);
    assert.equal(patch.operations[0]?.audioProcessingPreviousAssetId, undefined, "client-supplied treatment provenance must be removed");
    assert.equal(source.hasAudio, true);
    assert.equal(source.sourceWidth, 1920);
  }
  assert.equal(savedDocument?.clips.find((candidate) => candidate.id === clip.id)?.sourceDurationSeconds, 8);
  assert.deepEqual(checkedStoragePaths, ["production-assets/new.mp4"]);
  replacementRecord.checksum = null;
  await assert.rejects(() => applyAndAppendCompositionDocumentPatches(params), /medio de reemplazo no está disponible/);
  assert.equal(appendCount, 1, "un medio sin checksum no debe llegar al append versionado");
  replacementRecord.checksum = "b".repeat(64);
  storageStatus = "MISSING";
  await assert.rejects(() => applyAndAppendCompositionDocumentPatches(params), /ya no existe en Storage/);
  storageStatus = "SIZE_MISMATCH";
  await assert.rejects(() => applyAndAppendCompositionDocumentPatches(params), /no coincide con el registro/);
  storageStatus = "UNAVAILABLE";
  await assert.rejects(() => applyAndAppendCompositionDocumentPatches(params), /No se pudo verificar/);
  storageStatus = "THROW";
  await assert.rejects(() => applyAndAppendCompositionDocumentPatches(params), /No se pudo verificar/);
  assert.equal(appendCount, 1, "un archivo ausente o no verificable no debe crear una versión");
});

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

test("selects the latest saved occurrence when a document hash repeats", async () => {
  const documentHash = "a".repeat(64);
  const document = createInitialCompositionDocument({
    animatedDeck: { css: "", fonts: [], height: 1080, slides: [{ animationCount: 0, classes: "slide", html: "<section>Uno</section>", index: 0, label: "Uno" }], width: 1920 },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 5, subtitle: "Prueba", title: "Revisión repetida" },
  });
  const queryCalls: string[] = [];
  const documentQuery = {
    eq: (column: string, value: string) => { queryCalls.push(`eq:${column}:${value}`); return documentQuery; },
    limit: (count: number) => { queryCalls.push(`limit:${count}`); return documentQuery; },
    maybeSingle: async () => ({ data: { document, document_hash: documentHash, version: 3 }, error: null }),
    order: (column: string, options: { ascending: boolean }) => { queryCalls.push(`order:${column}:${options.ascending}`); return documentQuery; },
    select: () => documentQuery,
  };
  const assetLinksQuery = {
    eq: () => assetLinksQuery,
    select: () => assetLinksQuery,
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
  };
  const supabase = { from: (table: string) => table === "video_composition_draft_assets" ? assetLinksQuery : documentQuery };
  const saved = await getCompositionDocumentByHash({
    documentHash,
    draftId: DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    supabase: supabase as never,
  });
  assert.equal(saved.version, 3);
  assert.ok(queryCalls.includes(`eq:document_hash:${documentHash}`));
  assert.deepEqual(queryCalls.slice(-2), ["order:version:false", "limit:1"]);
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

test("persiste y recarga grupos como parte del documento versionado", async () => {
  const storedHash = "a".repeat(64);
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: "",
      fonts: [],
      height: 1080,
      slides: [
        { animationCount: 0, classes: "slide", html: "<section>Uno</section>", index: 0, label: "Uno" },
        { animationCount: 0, classes: "slide", html: "<section>Dos</section>", index: 1, label: "Dos" },
      ],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Round-trip de grupos" },
  });
  const clipIds = document.clips.map((clip) => clip.id);
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

  const saved = await applyAndAppendCompositionDocumentPatches({
    draftId: DRAFT_ID,
    expectedDocumentHash: storedHash,
    organizationId: ORGANIZATION_ID,
    patch: {
      operations: [{ clipIds, groupId: "group-round-trip", label: "Escena", type: "group.create" }],
      source: "USER",
      summary: "Agrupó dos diapositivas.",
    },
    supabase: saveClient as never,
    userId: "00000000-0000-4000-8000-000000000001",
  });

  assert.deepEqual(saved.document.groups, [{ clipIds, id: "group-round-trip", label: "Escena", order: 0 }]);
  assert.deepEqual(appendedDocument?.groups, saved.document.groups);
  assert.equal(appendedMetadata?.groupCount, 1);
  assert.deepEqual(appendedMetadata?.operations, ["group.create"]);

  const reloadDocumentQuery = {
    eq: () => reloadDocumentQuery,
    limit: () => reloadDocumentQuery,
    maybeSingle: async () => ({
      data: { document: appendedDocument, document_hash: saved.documentHash, version: saved.version },
      error: null,
    }),
    order: () => reloadDocumentQuery,
    select: () => reloadDocumentQuery,
  };
  const reloadClient = {
    from: (table: string) => table === "video_composition_draft_assets" ? assetLinksQuery : reloadDocumentQuery,
  };
  const reloaded = await getCurrentCompositionDocument({
    draftId: DRAFT_ID,
    organizationId: ORGANIZATION_ID,
    supabase: reloadClient as never,
  });

  assert.deepEqual(reloaded.document.groups, saved.document.groups);
  assert.equal(reloaded.documentHash, saved.documentHash);
  assert.equal(reloaded.version, 2);
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
