import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialCompositionDocument,
  reconcileCompositionDocument,
} from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import {
  applyCompositionEditorPatches,
  CompositionEditorPatchError,
} from "../editor-patch.service";
import { compositionEditorPatchRequestSchema } from "../editor-patch.types";
import {
  listCompositionTransitionEditPoints,
  resolveCompositionTransitionEligibility,
  resolveCompositionTransitionWindow,
} from "../composition-transition.service";
import { buildCompositionTransitionRuntime } from "../composition-transition-runtime";
import type { CompositionTransition } from "../composition-transition.types";

const buildAssets = () => [
  {
    checksum: "a".repeat(64),
    durationSeconds: 10,
    fileSizeBytes: 42,
    hasAudio: true,
    mimeType: "video/mp4",
    productionAssetId: "11111111-1111-4111-8111-111111111111",
    publicUrl: null,
    storageBucket: "production-assets",
    storagePath: "production-assets/from.mp4",
    timelineRole: "BROLL" as const,
  },
  {
    checksum: "b".repeat(64),
    durationSeconds: 10,
    fileSizeBytes: 42,
    hasAudio: true,
    mimeType: "video/mp4",
    productionAssetId: "22222222-2222-4222-8222-222222222222",
    publicUrl: null,
    storageBucket: "production-assets",
    storagePath: "production-assets/to.mp4",
    timelineRole: "BROLL" as const,
  },
];

const buildDocument = () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: buildAssets(),
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Transiciones" },
  });
  const [fromClip, toClip] = document.clips;
  assert.ok(fromClip);
  assert.ok(toClip);
  document.canvas.durationSeconds = 8;
  document.canvas.fps = 25;
  fromClip.startSeconds = 0;
  fromClip.durationSeconds = 4;
  fromClip.sourceDurationSeconds = 10;
  fromClip.sourceOffsetSeconds = 1;
  fromClip.timingSource = "USER_EDITED";
  toClip.startSeconds = 4;
  toClip.durationSeconds = 4;
  toClip.sourceDurationSeconds = 10;
  toClip.sourceOffsetSeconds = 1;
  toClip.timingSource = "USER_EDITED";
  return compositionEditorDocumentSchema.parse(document);
};

const buildTransition = (document = buildDocument()): CompositionTransition => ({
  alignment: "CENTER_AT_CUT",
  audioMode: "CUT",
  durationSeconds: 0.4,
  easing: "sine.inOut",
  fromClipId: document.clips[0]!.id,
  id: "transition-one",
  origin: "USER",
  toClipId: document.clips[1]!.id,
  type: "CROSS_DISSOLVE",
});

test("deriva una ventana centrada alrededor del punto de edición", () => {
  assert.deepEqual(resolveCompositionTransitionWindow({
    alignment: "CENTER_AT_CUT",
    cutSeconds: 4,
    durationSeconds: 0.4,
    incomingHeadHandleSeconds: 1,
    outgoingTailHandleSeconds: 5,
  }), {
    cutSeconds: 4,
    endSeconds: 4.2,
    incomingHeadHandleSeconds: 1,
    outgoingTailHandleSeconds: 5,
    requiredIncomingHeadSeconds: 0.2,
    requiredOutgoingTailSeconds: 0.2,
    startSeconds: 3.8,
  });
});

test("extiende solo la proyección runtime y ajusta el offset del clip entrante", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  const runtime = buildCompositionTransitionRuntime(withTransition);
  assert.deepEqual(runtime.clipWindowsById.get(document.clips[0]!.id), {
    durationSeconds: 4.2,
    endSeconds: 4.2,
    sourceOffsetSeconds: 1,
    startSeconds: 0,
  });
  assert.deepEqual(runtime.clipWindowsById.get(document.clips[1]!.id), {
    durationSeconds: 4.2,
    endSeconds: 8,
    sourceOffsetSeconds: 0.8,
    startSeconds: 3.8,
  });
  assert.equal(withTransition.clips[0]!.durationSeconds, 4);
  assert.equal(withTransition.clips[1]!.sourceOffsetSeconds, 1);
});

test("calcula elegibilidad y duración máxima con handles reales", () => {
  const document = buildDocument();
  const result = resolveCompositionTransitionEligibility({ document, transition: buildTransition(document) });
  assert.equal(result.available, true);
  assert.equal(result.maximumDurationSeconds, 1);
  assert.equal(result.window?.cutSeconds, 4);
});

test("enumera únicamente cortes visuales adyacentes y señala los ya ocupados", () => {
  const document = buildDocument();
  const points = listCompositionTransitionEditPoints(document);
  assert.equal(points.length, 1);
  assert.equal(points[0]?.cutSeconds, 4);
  assert.equal(points[0]?.existingTransitionId, null);

  const edited = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  assert.equal(listCompositionTransitionEditPoints(edited)[0]?.existingTransitionId, "transition-one");
});

test("crossfade exige audio confirmado en ambos extremos y extiende sus ventanas runtime", () => {
  const document = buildDocument();
  const crossfade = { ...buildTransition(document), audioMode: "CROSSFADE" as const };
  const eligibility = resolveCompositionTransitionEligibility({ document, transition: crossfade });
  assert.equal(eligibility.available, true);

  const edited = applyCompositionEditorPatches(document, [{ transition: crossfade, type: "transition.add" }]);
  const runtime = buildCompositionTransitionRuntime(edited);
  assert.deepEqual(runtime.audioWindowsByClipId.get(document.clips[0]!.id), {
    durationSeconds: 4.2,
    endSeconds: 4.2,
    sourceOffsetSeconds: 1,
    startSeconds: 0,
  });
  assert.deepEqual(runtime.audioWindowsByClipId.get(document.clips[1]!.id), {
    durationSeconds: 4.2,
    endSeconds: 8,
    sourceOffsetSeconds: 0.8,
    startSeconds: 3.8,
  });

  const incoming = document.clips[1]!;
  assert.equal(incoming.source.type, "PRODUCTION_ASSET");
  if (incoming.source.type !== "PRODUCTION_ASSET") throw new Error("Expected production asset source.");
  incoming.source.hasAudio = false;
  const unavailable = resolveCompositionTransitionEligibility({ document, transition: crossfade });
  assert.equal(unavailable.available, false);
  assert.ok(unavailable.issues.some((issue) => issue.code === "AUDIO_CROSSFADE_UNAVAILABLE"));
});

test("la alineación determina qué handle se necesita", () => {
  const document = buildDocument();
  document.clips[1]!.sourceOffsetSeconds = 0;
  const centered = resolveCompositionTransitionEligibility({ document, transition: buildTransition(document) });
  assert.equal(centered.available, false);
  assert.ok(centered.issues.some((issue) => issue.code === "INSUFFICIENT_MEDIA_HANDLES"));

  const startAtCut = resolveCompositionTransitionEligibility({
    document,
    transition: { ...buildTransition(document), alignment: "START_AT_CUT" },
  });
  assert.equal(startAtCut.available, true);
});

test("rechaza videos sin duración de fuente verificada", () => {
  const document = buildDocument();
  delete document.clips[0]!.sourceDurationSeconds;
  const result = resolveCompositionTransitionEligibility({ document, transition: buildTransition(document) });
  assert.equal(result.available, false);
  assert.ok(result.issues.some((issue) => issue.code === "SOURCE_DURATION_REQUIRED"));
});

test("detecta un tercer clip visible que ocupa la ventana", () => {
  const document = buildDocument();
  document.clips.push({
    ...structuredClone(document.clips[0]!),
    durationSeconds: 0.4,
    hfId: "third-clip",
    id: "third-clip",
    startSeconds: 3.8,
  });
  const result = resolveCompositionTransitionEligibility({ document, transition: buildTransition(document) });
  assert.equal(result.available, false);
  assert.ok(result.issues.some((issue) => issue.code === "THIRD_CLIP_CONFLICT"));
});

test("mantiene legibles documentos anteriores sin subcontrato de transiciones", () => {
  const document = buildDocument();
  const legacyCompatible = structuredClone(document) as Record<string, unknown>;
  delete legacyCompatible.transitions;
  assert.equal(compositionEditorDocumentSchema.safeParse(legacyCompatible).success, true);
});

test("el esquema rechaza referencias inexistentes y puntos de edición duplicados", () => {
  const document = buildDocument();
  const transition = buildTransition(document);
  assert.equal(compositionEditorDocumentSchema.safeParse({
    ...document,
    transitions: { items: [{ ...transition, toClipId: "missing-clip" }], schemaVersion: 1 },
  }).success, false);
  assert.equal(compositionEditorDocumentSchema.safeParse({
    ...document,
    transitions: { items: [transition, { ...transition, id: "transition-two" }], schemaVersion: 1 },
  }).success, false);
});

test("valida y aplica add, update y remove como operaciones declarativas", () => {
  const document = buildDocument();
  const transition = buildTransition(document);
  const request = compositionEditorPatchRequestSchema.parse({
    operations: [{ transition, type: "transition.add" }],
    source: "USER",
    summary: "Añadir disolvencia",
  });
  const added = applyCompositionEditorPatches(document, request.operations, request.source);
  assert.deepEqual(added.transitions?.items, [transition]);

  const updated = applyCompositionEditorPatches(added, [{
    settings: { durationSeconds: 0.8, easing: "power2.inOut" },
    transitionId: transition.id,
    type: "transition.update",
  }]);
  assert.equal(updated.transitions?.items[0]?.durationSeconds, 0.8);
  assert.equal(updated.transitions?.items[0]?.easing, "power2.inOut");

  const removed = applyCompositionEditorPatches(updated, [{
    transitionId: transition.id,
    type: "transition.remove",
  }]);
  assert.deepEqual(removed.transitions?.items, []);
});

test("reporta configuraciones incompatibles como error seguro del editor", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  assert.throws(
    () => applyCompositionEditorPatches(withTransition, [{
      settings: { type: "PUSH" },
      transitionId: "transition-one",
      type: "transition.update",
    }]),
    (error: unknown) => error instanceof CompositionEditorPatchError
      && /requiere una dirección/.test(error.message),
  );
});

test("una edición que rompe la adyacencia falla atómicamente", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  const originalStart = withTransition.clips[1]!.startSeconds;
  assert.throws(
    () => applyCompositionEditorPatches(withTransition, [{
      clipId: withTransition.clips[1]!.id,
      startSeconds: 3,
      type: "clip.move",
    }]),
    (error: unknown) => error instanceof CompositionEditorPatchError
      && /final del primer clip/.test(error.message),
  );
  assert.equal(withTransition.clips[1]!.startSeconds, originalStart);
});

test("eliminar un clip limpia sus transiciones conectadas", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  const edited = applyCompositionEditorPatches(withTransition, [{
    clipId: withTransition.clips[0]!.id,
    type: "clip.remove",
  }]);
  assert.deepEqual(edited.transitions?.items, []);
});

test("reconcile elimina relaciones huérfanas cuando desaparece un asset", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  const reconciled = reconcileCompositionDocument({
    animatedDeck: null,
    deckDependencyAssetIds: new Set(),
    document: withTransition,
    productionAssets: [buildAssets()[0]!],
  });
  assert.equal(reconciled.removedOrphanTransitionCount, 1);
  assert.deepEqual(reconciled.document.transitions?.items, []);
});

test("reconcile retira transiciones cuyos nuevos metadatos ya no ofrecen handles", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  const assets = buildAssets();
  assets[1] = { ...assets[1]!, durationSeconds: 0.1 };
  const reconciled = reconcileCompositionDocument({
    animatedDeck: null,
    deckDependencyAssetIds: new Set(),
    document: withTransition,
    productionAssets: assets,
  });
  assert.equal(reconciled.removedInvalidTransitionCount, 1);
  assert.deepEqual(reconciled.document.transitions?.items, []);
});

test("split transfiere la transición saliente al fragmento derecho", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  const edited = applyCompositionEditorPatches(withTransition, [{
    atSeconds: 2,
    clipId: withTransition.clips[0]!.id,
    newClipId: "from-right",
    newHfId: "from-right",
    type: "clip.split",
  }]);
  assert.equal(edited.transitions?.items[0]?.fromClipId, "from-right");
});

test("remove-range con ripple rechaza una transición que deja de tocar el corte", () => {
  const document = buildDocument();
  const withTransition = applyCompositionEditorPatches(document, [{
    transition: buildTransition(document),
    type: "transition.add",
  }]);
  assert.throws(
    () => applyCompositionEditorPatches(withTransition, [{
      clipId: withTransition.clips[0]!.id,
      endSeconds: 2,
      newClipId: "from-after-range",
      newHfId: "from-after-range",
      ripple: true,
      startSeconds: 1,
      type: "clip.remove-range",
    }]),
    (error: unknown) => error instanceof CompositionEditorPatchError
      && /final del primer clip/.test(error.message),
  );
});
