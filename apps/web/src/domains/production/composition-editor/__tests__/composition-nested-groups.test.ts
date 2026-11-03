import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "../composition-document.types";
import { buildCompositionGroupIndex, resolveCompositionGroupClipIds, resolveCompositionGroupSelection, toggleCompositionGroupSelection, validateCompositionGroupGraph } from "../composition-group-hierarchy";
import { applyCompositionEditorPatches, ensureCanvasDurationForClipPatches } from "../editor-patch.service";
import { hashCompositionDocument } from "../composition-document-hash";
import { buildCompositionDuplicateSelectionPlan } from "../composition-timeline-batch.service";
import { assertCompositionGroupingWrite, CompositionGroupingPolicyError } from "../composition-group-policy";
import graphFixtures from "./fixtures/composition-group-graphs.json";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { resolveCompositionTimelineNesting } from "../composition-timeline-nesting.service";

test("anidar colapsa un rango con huecos y conserva el documento de reproducción", async () => {
  const initial = fixture();
  const ids = initial.clips.slice(0, 2).map(clip => clip.id);
  const nested = applyCompositionEditorPatches(initial, [{ type: "group.create", groupId: "sequence-a", clipIds: ids, timelineMode: "NESTED" }]);
  const reloaded = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(nested)));
  assert.equal(reloaded.groups?.[0]?.timelineMode, "NESTED");
  assert.deepEqual(reloaded.clips, initial.clips);
  assert.equal(initial.groups, undefined);
  const root = resolveCompositionTimelineNesting(reloaded, null);
  assert.equal(root.containers.length, 1);
  assert.deepEqual(root.containers[0]!.bounds, { startSeconds: 0, endSeconds: 3, durationSeconds: 3 });
  assert.deepEqual(root.clips.map(clip => clip.id), initial.clips.slice(2).map(clip => clip.id));
  const opened = resolveCompositionTimelineNesting(reloaded, "sequence-a");
  assert.equal(opened.containers.length, 0);
  assert.deepEqual(opened.clips.map(clip => clip.id), ids);
  const duplicate = buildCompositionDuplicateSelectionPlan({ document: reloaded, clipIds: ids, destinationStartSeconds: 10 });
  const copied = applyCompositionEditorPatches(reloaded, duplicate.operations);
  assert.equal(copied.groups?.filter(group => group.timelineMode === "NESTED").length, 2);
  assert.equal(resolveCompositionTimelineNesting(copied, null).containers.length, 2);
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    assert.equal(await compileCompositionPreview({ document: reloaded, assetUrls: new Map(), target }),
      await compileCompositionPreview({ document: initial, assetUrls: new Map(), target }));
  }
  const restored = applyCompositionEditorPatches(reloaded, [{ type: "group.ungroup", groupId: "sequence-a" }]);
  assert.deepEqual(restored.clips, initial.clips);
  assert.equal(resolveCompositionTimelineNesting(restored, null).containers.length, 0);
});

test("grupos ordinarios no colapsan y las anidaciones se proyectan por nivel", () => {
  const { flat, ids } = tree();
  assert.equal(resolveCompositionTimelineNesting(flat, null).clips.length, flat.clips.length);
  const inner = applyCompositionEditorPatches(flat, [{ type: "group.create", groupId: "inner", clipIds: [], childGroupIds: ["group-a", "group-b"], timelineMode: "NESTED" }]);
  const outer = applyCompositionEditorPatches(inner, [{ type: "group.create", groupId: "outer", clipIds: ids.slice(4), childGroupIds: ["inner"], timelineMode: "NESTED" }]);
  assert.deepEqual(resolveCompositionTimelineNesting(outer, null).containers.map(item => item.group.id), ["outer"]);
  assert.deepEqual(resolveCompositionTimelineNesting(outer, "outer").containers.map(item => item.group.id), ["inner"]);
  assert.equal(resolveCompositionTimelineNesting(outer, "inner").clips.length, 4);
});

test("ocultar extremos de transiciones no invalida el layout editorial", () => {
  const initial = fixture();
  initial.clips[0]!.durationSeconds = 2;
  const transitioned = applyCompositionEditorPatches(initial, [{ type: "transition.add", transition: {
    id: "transition-nested", type: "CROSS_DISSOLVE", alignment: "CENTER_AT_CUT", audioMode: "CUT",
    durationSeconds: 0.16, easing: "sine.inOut", fromClipId: initial.clips[0]!.id,
    toClipId: initial.clips[1]!.id, origin: "USER",
  } }]);
  const nested = applyCompositionEditorPatches(transitioned, [{ type: "group.create", groupId: "sequence-transition",
    clipIds: [initial.clips[0]!.id, initial.clips[2]!.id], timelineMode: "NESTED" }]);
  const root = resolveCompositionTimelineNesting(nested, null);
  assert.equal(root.containers.length, 1);
  assert.ok(root.groups.some(group => group.clips.some(clip => clip.id === initial.clips[1]!.id)));
  assert.doesNotThrow(() => resolveCompositionTimelineNesting(nested, "sequence-transition"));
});

test("el servidor exige capacidad para crear anidaciones, conservando lectura y desanidación", () => {
  const initial = fixture();
  const nested = applyCompositionEditorPatches(initial, [{ type: "group.create", groupId: "sequence-a", clipIds: initial.clips.slice(0, 2).map(clip => clip.id), timelineMode: "NESTED" }]);
  assert.throws(() => assertCompositionGroupingWrite({ before: initial, after: nested, clientVersion: "2", canCreateNestedGroups: true }), /no está habilitada/);
  assert.doesNotThrow(() => assertCompositionGroupingWrite({ before: initial, after: nested, clientVersion: "2", canCreateNestedGroups: true, canNestTimeline: true }));
  assert.doesNotThrow(() => assertCompositionGroupingWrite({ before: nested, after: nested, clientVersion: "2", canCreateNestedGroups: false }));
  const restored = applyCompositionEditorPatches(nested, [{ type: "group.ungroup", groupId: "sequence-a" }]);
  assert.doesNotThrow(() => assertCompositionGroupingWrite({ before: nested, after: restored, clientVersion: "2", canCreateNestedGroups: false }));
  assert.equal(compositionEditorDocumentSchema.safeParse({ ...nested, groupingVersion: undefined }).success, false);
});

test("fixtures compartidos con SQL conservan las mismas reglas de grafo", () => {
  for (const fixture of graphFixtures) {
    assert.equal(validateCompositionGroupGraph(fixture.document.groups, new Set(fixture.document.clips.map(clip => clip.id)), fixture.document.groupingVersion).length === 0, fixture.valid, fixture.name);
  }
});

function fixture(): CompositionEditorDocument {
  const document = createInitialCompositionDocument({ animatedDeck: { css: "", fonts: [], height: 1080, width: 1920,
    slides: Array.from({ length: 6 }, (_, index) => ({ animationCount: 0, classes: "slide", html: "<section>Prueba</section>", index, label: `Clip ${index}` })) },
    assets: [], plan: { accentColor: "#38BDF8", durationSeconds: 40, subtitle: "", title: "Jerarquía" } });
  document.clips.forEach((clip, index) => { clip.startSeconds = index * 2; clip.durationSeconds = 1; });
  document.canvas.durationSeconds = 40;
  return document;
}
function tree() {
  const initial = fixture();
  const ids = initial.clips.map(clip => clip.id);
  const flat = applyCompositionEditorPatches(initial, [
    { type: "group.create", groupId: "group-a", clipIds: ids.slice(0, 2) },
    { type: "group.create", groupId: "group-b", clipIds: ids.slice(2, 4) },
  ]);
  const nested = applyCompositionEditorPatches(flat, [{ type: "group.create", groupId: "group-parent", clipIds: [], childGroupIds: ["group-a", "group-b"] }]);
  return { initial, flat, nested, ids };
}

test("seleccionar grupos completos conserva hermanos y respeta el nivel actual", () => {
  const { flat, nested, ids } = tree();
  const first = toggleCompositionGroupSelection(flat, new Set(), "group-a");
  assert.deepEqual([...first], ids.slice(0, 2));
  const both = toggleCompositionGroupSelection(flat, first, "group-b");
  assert.deepEqual([...both], ids.slice(0, 4));
  assert.deepEqual([...first], ids.slice(0, 2));
  assert.deepEqual([...toggleCompositionGroupSelection(flat, both, "group-a")], ids.slice(2, 4));
  assert.throws(() => toggleCompositionGroupSelection(nested, new Set(), "group-a"), /nivel actual/);
  assert.deepEqual([...toggleCompositionGroupSelection(nested, new Set(), "group-a", "group-parent")], ids.slice(0, 2));
  assert.throws(() => toggleCompositionGroupSelection(flat, first, "missing"), /nivel actual/);
});

test("agrupa hermanos conservando IDs, hojas, tiempos y documento fuente", () => {
  const { initial, flat, nested, ids } = tree();
  assert.equal(flat.groupingVersion, undefined);
  assert.equal(nested.groupingVersion, 2);
  assert.deepEqual(resolveCompositionGroupClipIds(nested, "group-parent"), ids.slice(0, 4));
  assert.deepEqual(nested.clips, initial.clips);
  assert.deepEqual(flat.groups?.map(group => group.id), ["group-a", "group-b"]);
  assert.equal(buildCompositionGroupIndex(nested.groups).parentByGroupId.get("group-a"), "group-parent");
});

test("resuelve selección por nivel sin aplanar las unidades", () => {
  const { flat, nested, ids } = tree();
  assert.deepEqual(resolveCompositionGroupSelection(flat, new Set(ids.slice(0, 4))), { clipIds: [], childGroupIds: ["group-a", "group-b"] });
  assert.equal(resolveCompositionGroupSelection(nested, new Set([ids[0]!, ids[4]!])), null);
  assert.deepEqual(resolveCompositionGroupSelection(nested, new Set(ids.slice(0, 4)), "group-parent"), { clipIds: [], childGroupIds: ["group-a", "group-b"] });
});

test("grupo mixto y desagrupación conservan los subgrupos", () => {
  const { flat, ids } = tree();
  const mixed = applyCompositionEditorPatches(flat, [{ type: "group.create", groupId: "group-mixed", clipIds: [ids[4]!], childGroupIds: ["group-a"] }]);
  const ungrouped = applyCompositionEditorPatches(mixed, [{ type: "group.ungroup", groupId: "group-mixed" }]);
  assert.deepEqual(ungrouped.groups, flat.groups);
  assert.equal(ungrouped.groupingVersion, 2);
});

test("agrupar clips hermanos dentro de un grupo legacy migra explícitamente el contrato", () => {
  const initial = fixture(); const ids = initial.clips.map(clip => clip.id);
  const flat = applyCompositionEditorPatches(initial, [{ type: "group.create", groupId: "group-existing", clipIds: ids.slice(0, 3) }]);
  const nested = applyCompositionEditorPatches(flat, [{ type: "group.create", groupId: "group-inner", clipIds: ids.slice(0, 2), childGroupIds: [] }]);
  assert.equal(nested.groupingVersion, 2);
  assert.deepEqual(nested.groups?.find(group => group.id === "group-existing")?.childGroupIds, ["group-inner"]);
  assert.deepEqual(nested.clips, initial.clips);
});

test("mover padre aplica un delta único y rechaza pistas bloqueadas sin efectos parciales", () => {
  const { nested, ids } = tree();
  const moved = applyCompositionEditorPatches(nested, [{ type: "group.move", groupId: "group-parent", startSeconds: 10 }]);
  for (const clip of moved.clips) assert.equal(clip.startSeconds, nested.clips.find(source => source.id === clip.id)!.startSeconds + (ids.slice(0, 4).includes(clip.id) ? 10 : 0));
  const locked = structuredClone(nested); locked.tracks[0]!.locked = true;
  assert.throws(() => applyCompositionEditorPatches(locked, [{ type: "group.move", groupId: "group-parent", startSeconds: 10 }]), /bloqueada/);
  assert.deepEqual(locked.clips, nested.clips);
});

test("la proyección amplía el canvas al agrupar y mover descendientes en un solo lote", () => {
  const { flat, ids } = tree();
  const operations = ensureCanvasDurationForClipPatches(flat, [
    { type: "group.create", groupId: "group-new-parent", clipIds: [], childGroupIds: ["group-a", "group-b"] },
    { type: "group.move", groupId: "group-new-parent", startSeconds: 39 },
  ]);
  const applied = applyCompositionEditorPatches(flat, operations);
  assert.equal(applied.canvas.durationSeconds, 46);
  assert.equal(applied.clips.find(clip => clip.id === ids[3])!.startSeconds, 45);
  assert.equal(flat.canvas.durationSeconds, 40);
});

test("eliminar normaliza contenedores de abajo hacia arriba sin perder hojas", () => {
  const { nested, ids } = tree();
  const edited = applyCompositionEditorPatches(nested, [{ type: "clip.remove", clipId: ids[0]! }]);
  assert.equal(edited.groups?.some(group => group.id === "group-a"), false);
  assert.deepEqual(edited.groups?.find(group => group.id === "group-parent")?.clipIds, [ids[1]!]);
  assert.deepEqual(resolveCompositionGroupClipIds(edited, "group-parent").sort(), ids.slice(1, 4).sort());
});

test("copiar un padre reconstruye hijos antes que padre y rechaza selección parcial", () => {
  const { nested, ids } = tree();
  // Se duplica al final; evita la inserción en clips independientes.
  const plan = buildCompositionDuplicateSelectionPlan({ document: nested, clipIds: ids.slice(0, 4), destinationStartSeconds: 20 });
  const applied = applyCompositionEditorPatches(nested, plan.operations);
  assert.equal(applied.groups?.length, 6);
  const parent = applied.groups?.find(group => group.id !== "group-parent" && group.childGroupIds?.length === 2);
  assert.ok(parent);
  assert.equal(resolveCompositionGroupClipIds(applied, parent.id).length, 4);
  assert.ok(resolveCompositionGroupClipIds(applied, parent.id).every(id => !ids.includes(id)));
  assert.throws(() => buildCompositionDuplicateSelectionPlan({ document: nested, clipIds: ids.slice(0, 2) }), /completo/);
});

test("lectura y restauración mantienen hashes legacy y marcador persistente", () => {
  const { flat, nested } = tree();
  assert.equal(hashCompositionDocument(compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(flat)))), hashCompositionDocument(flat));
  const restored = applyCompositionEditorPatches(nested, [{ type: "document.restore", document: flat }]);
  assert.equal(restored.groupingVersion, 2);
  assert.deepEqual(restored.groups, flat.groups);
  assert.equal(flat.groupingVersion, undefined);
});

test("rechaza ciclos, padre duplicado, referencias inválidas y childGroupIds legacy", () => {
  const { nested } = tree();
  for (const mutate of [
    (doc: CompositionEditorDocument) => { doc.groups![0]!.childGroupIds = ["group-parent"]; },
    (doc: CompositionEditorDocument) => { doc.groups![1]!.childGroupIds = ["group-a"]; },
    (doc: CompositionEditorDocument) => { doc.groups![2]!.childGroupIds = ["missing", "group-a"]; },
    (doc: CompositionEditorDocument) => { delete doc.groupingVersion; },
  ]) {
    const invalid = structuredClone(nested); mutate(invalid);
    assert.equal(compositionEditorDocumentSchema.safeParse(invalid).success, false);
  }
});

test("el límite acepta ocho niveles y rechaza nueve", () => {
  const make = (depth: number) => Array.from({ length: depth }, (_, i) => ({ id: `group-${i}`, order: i,
    clipIds: i === depth - 1 ? [`clip-${i}`, `clip-${i + 1}`] : [`clip-${i}`],
    ...(i < depth - 1 ? { childGroupIds: [`group-${i + 1}`] } : {}) }));
  const clips = new Set(Array.from({ length: 10 }, (_, i) => `clip-${i}`));
  assert.deepEqual(validateCompositionGroupGraph(make(8), clips, 2), []);
  assert.ok(validateCompositionGroupGraph(make(9), clips, 2).length);
});

test("el rechazo de membresías masivas duplicadas genera un diagnóstico acotado", () => {
  const groups = Array.from({ length: 250 }, (_, index) => ({ id: `group-${index}`, order: index, clipIds: Array<string>(500).fill("clip-a") }));
  assert.equal(validateCompositionGroupGraph(groups, new Set(["clip-a"]), 2).length, 1);
});

test("política exige cliente compatible y bloquea creaciones incluso en restore", () => {
  const { flat, nested } = tree();
  assert.throws(() => assertCompositionGroupingWrite({ before: flat, after: nested, clientVersion: undefined, canCreateNestedGroups: true }), CompositionGroupingPolicyError);
  assert.throws(() => assertCompositionGroupingWrite({ before: flat, after: nested, clientVersion: "2", canCreateNestedGroups: false }), /deshabilitada/);
  assert.doesNotThrow(() => assertCompositionGroupingWrite({ before: nested, after: nested, clientVersion: "2", canCreateNestedGroups: false }));
});

test("deshabilitar creaciones permite promover subgrupos al desagrupar", () => {
  const { nested, ids } = tree();
  const deeper = applyCompositionEditorPatches(nested, [{ type: "group.create", groupId: "group-outer", clipIds: [ids[4]!], childGroupIds: ["group-parent"] }]);
  const simplified = applyCompositionEditorPatches(deeper, [{ type: "group.ungroup", groupId: "group-parent" }]);
  assert.doesNotThrow(() => assertCompositionGroupingWrite({ before: deeper, after: simplified, clientVersion: "2", canCreateNestedGroups: false }));
  assert.throws(() => assertCompositionGroupingWrite({ before: simplified, after: deeper, clientVersion: "2", canCreateNestedGroups: false }), /deshabilitada/);
});

test("agrupar sin mover conserva exactamente la compilación de preview y render", async () => {
  const { flat, nested } = tree();
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    assert.equal(await compileCompositionPreview({ document: nested, assetUrls: new Map(), target }),
      await compileCompositionPreview({ document: flat, assetUrls: new Map(), target }));
  }
});

test("avatar y voz en subgrupos hermanos se mueven una vez con su padre", () => {
  const initial = createInitialCompositionDocument({ animatedDeck: null, assets: [
    { checksum: "1".repeat(64), durationSeconds: 8, fileSizeBytes: 42, hasAudio: true, mimeType: "video/mp4",
      productionAssetId: "11111111-1111-4111-8111-111111111121", publicUrl: null, sceneClipId: "scene-avatar-1", sceneOrder: 1,
      storageBucket: "production-assets", storagePath: "avatar.mp4", timelineRole: "AVATAR" },
    { checksum: "2".repeat(64), durationSeconds: 8, fileSizeBytes: 42, mimeType: "audio/mpeg",
      productionAssetId: "22222222-2222-4222-8222-222222222232", publicUrl: null, sceneClipId: "scene-avatar-1", sceneOrder: 1,
      storageBucket: "production-assets", storagePath: "voice.mp3", timelineRole: "VOICE" },
  ], plan: { accentColor: "#38BDF8", durationSeconds: 30, subtitle: "", title: "Vínculos anidados" } });
  initial.canvas.durationSeconds = 30;
  const avatar = initial.clips.find(clip => clip.trackId === "avatar")!;
  const voice = initial.clips.find(clip => clip.trackId === "voice")!;
  for (const clip of [avatar, voice]) initial.clips.push({ ...structuredClone(clip), id: `${clip.id}-independent`, hfId: `${clip.hfId}-independent`, sceneId: undefined });
  const grouped = applyCompositionEditorPatches(initial, [
    { type: "group.create", groupId: "group-avatar", clipIds: [avatar.id, `${avatar.id}-independent`] },
    { type: "group.create", groupId: "group-voice", clipIds: [voice.id, `${voice.id}-independent`] },
    { type: "group.create", groupId: "group-pair", clipIds: [], childGroupIds: ["group-avatar", "group-voice"] },
  ]);
  const moved = applyCompositionEditorPatches(grouped, [{ type: "group.move", groupId: "group-pair", startSeconds: 5 }]);
  assert.equal(moved.clips.find(clip => clip.id === avatar.id)!.startSeconds, avatar.startSeconds + 5);
  assert.equal(moved.clips.find(clip => clip.id === voice.id)!.startSeconds, voice.startSeconds + 5);
  assert.throws(() => applyCompositionEditorPatches(grouped, [{ type: "group.move", groupId: "group-avatar", startSeconds: 5 }]), /dos grupos/);
  const split = applyCompositionEditorPatches(grouped, [{ type: "clip.split", clipId: `${avatar.id}-independent`, atSeconds: 4, newClipId: "avatar-right", newHfId: "hf-avatar-right" }]);
  assert.equal(buildCompositionGroupIndex(split.groups).parentByClipId.get("avatar-right"), "group-avatar");
});

test("el grafo máximo permanece acotado y reutilizable por selección y UI", () => {
  const clips = new Set(Array.from({ length: 500 }, (_, i) => `clip-${i}`));
  const groups = Array.from({ length: 249 }, (_, i) => ({ id: `group-${i}`, order: i, clipIds: [`clip-${i * 2}`, `clip-${i * 2 + 1}`] }));
  const maximum = [...groups, { id: "group-root", order: 249, clipIds: [], childGroupIds: groups.map(group => group.id) }];
  assert.deepEqual(validateCompositionGroupGraph(maximum, clips, 2), []);
  assert.equal(buildCompositionGroupIndex(maximum).leavesByGroupId.get("group-root")!.length, 498);
});
