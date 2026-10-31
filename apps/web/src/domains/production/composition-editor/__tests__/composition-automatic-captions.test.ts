import assert from "node:assert/strict";
import test from "node:test";
import type { MaterialAssets } from "../../../materials/types/materials.types";
import { ensureProductionNativeCaptions, planProductionNativeCaptions, type ProductionNativeCaptionPorts } from "../../automation/production-native-captions.service";
import { narrativeFingerprint } from "../composition-narrative-source.service";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { createNarrativeDocumentFixture } from "./fixtures/composition-narrative.fixture";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { nativeCaptionsEnabledForItem, productionAutomationConfigurationSchema } from "../../automation/production-automation-configuration";

test("la opción requiere booleano, aprobación y respeta un override false", () => {
  assert.equal(productionAutomationConfigurationSchema.safeParse({ defaults: { nativeCaptions: "true" } }).success, false);
  assert.equal(productionAutomationConfigurationSchema.safeParse({ defaults: { nativeCaptions: true, unknown: true } }).success, false);
  const parsed = productionAutomationConfigurationSchema.parse({ approve: true, defaults: { nativeCaptions: true },
    items: [{ componentId: "11111111-1111-4111-8111-111111111111", nativeCaptions: false }] });
  assert.equal(parsed.items[0]!.nativeCaptions, false);
  assert.equal(nativeCaptionsEnabledForItem(null, null), false);
  assert.equal(nativeCaptionsEnabledForItem({ approval_state: "DRAFT", defaults: { nativeCaptions: true } }, null), false);
  assert.equal(nativeCaptionsEnabledForItem({ approval_state: "APPROVED" }, null), false);
  const run = { approval_state: "APPROVED" as const, defaults: { nativeCaptions: true } };
  assert.equal(nativeCaptionsEnabledForItem(run, null), true);
  assert.equal(nativeCaptionsEnabledForItem(run, { nativeCaptions: false }), false);
});

function fixture() {
  let document = createNarrativeDocumentFixture();
  const scene = document.narrativeScenes![0]!;
  scene.scriptHash = narrativeFingerprint(scene.scriptText);
  const assets: MaterialAssets = {
    avatar_generation_mode: "scene_clips",
    avatar_clips: [{ id: scene.id, order: 1, script_text: scene.scriptText, expected_media_mode: "voice_only", status: "COMPLETED" }],
    voice_clips: [{ id: "voice", clip_id: scene.id, asset_id: "11111111-1111-4111-8111-111111111111", order: 1,
      script_hash: scene.scriptHash, status: "COMPLETED", word_timestamps: structuredClone(scene.wordTimestamps) }],
  };
  const context = { organizationId: "organization-1", userId: "user-1", componentId: "component-1", itemId: "item-1", assets };
  const calls: string[] = [];
  let version = 1;
  const conflict = new Error("conflicto simulado");
  const ports: ProductionNativeCaptionPorts = {
    async prepare(scope) { assert.equal(scope.organizationId, context.organizationId); calls.push("prepare"); return "draft-1"; },
    async read(scope) { assert.equal(scope.organizationId, context.organizationId); calls.push("read"); return { document, documentHash: String(version) }; },
    async append(input) {
      assert.equal(input.organizationId, context.organizationId);
      assert.equal(input.draftId, "draft-1");
      assert.equal(input.userId, context.userId);
      assert.equal(input.expectedDocumentHash, String(version));
      calls.push("append");
      document = applyCompositionEditorPatches(document, input.operations, "SYSTEM");
      version++;
    },
    isConflict: error => error === conflict,
  };
  return { context, ports, calls, conflict, document: () => document };
}

test("la automatización crea una capa transparente sincronizada y un reintento no vuelve a escribir", async () => {
  const state = fixture();
  const first = await ensureProductionNativeCaptions(state.context, state.ports);
  assert.equal(first.status, "READY");
  const clip = state.document().clips.find(candidate => candidate.hfId === first.hfId)!;
  assert.equal(clip.startSeconds, 0);
  assert.equal(clip.durationSeconds, state.document().canvas.durationSeconds);
  assert.ok(clip.source.type === "NATIVE_CAPTIONS");
  assert.equal(clip.source.style.backgroundOpacity, 0);
  assert.equal(clip.source.origin, "TRANSCRIPT");
  // La voz empieza en 10s y está recortada desde 1s de la fuente.
  assert.equal(clip.source.cues[0]!.startSeconds, 10);
  assert.equal(clip.source.cues[0]!.words![0]!.text, "café");
  const second = await ensureProductionNativeCaptions({ ...state.context, previous: first }, state.ports);
  assert.deepEqual(second, first);
  assert.equal(state.calls.filter(call => call === "append").length, 1);
});

test("los captions automáticos conservan tiempos y fondo transparente en preview y render", async () => {
  const state = fixture();
  await ensureProductionNativeCaptions(state.context, state.ports);
  const document = structuredClone(state.document());
  document.clips = document.clips.filter(clip => clip.source.type === "NATIVE_CAPTIONS");
  for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
    const html = await compileCompositionPreview({ document, target, assetUrls: new Map() });
    assert.match(html, /background:rgba\(0,0,0,0\)/);
    assert.match(html, /auto-captions-item-1-caption-transcript-cue-1/);
    assert.match(html, /"start":10/);
  }
});

test("la identidad registrada sobrevive a la pérdida temporal de timestamps", async () => {
  const state = fixture();
  const previous = await ensureProductionNativeCaptions(state.context, state.ports);
  const words = state.context.assets.voice_clips![0]!.word_timestamps;
  state.context.assets.voice_clips![0]!.word_timestamps = [];
  const waiting = await ensureProductionNativeCaptions({ ...state.context, previous }, state.ports);
  assert.equal(waiting.hfId, previous.hfId);
  state.document().clips = state.document().clips.filter(clip => clip.source.type !== "NATIVE_CAPTIONS");
  state.context.assets.voice_clips![0]!.word_timestamps = words;
  const result = await ensureProductionNativeCaptions({ ...state.context, previous: waiting }, state.ports);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(state.calls.filter(call => call === "append").length, 1);
});

test("sin timestamps actuales no prepara borradores ni invoca persistencia", async () => {
  for (const invalidate of [
    (assets: MaterialAssets) => { assets.voice_clips![0]!.word_timestamps = []; },
    (assets: MaterialAssets) => { assets.voice_clips![0]!.script_hash = "b".repeat(64); },
    (assets: MaterialAssets) => { assets.avatar_generation_mode = "single_video"; },
  ]) {
    const state = fixture();
    invalidate(state.context.assets);
    assert.equal((await ensureProductionNativeCaptions(state.context, state.ports)).status, "WAITING_TIMESTAMPS");
    assert.deepEqual(state.calls, []);
  }
});

test("timestamps parciales y voces sin asociación no generan subtítulos parciales", async () => {
  const state = fixture();
  state.context.assets.avatar_clips!.push({ id: "scene-2", order: 2, script_text: "Sin tiempos", status: "COMPLETED" });
  assert.equal((await ensureProductionNativeCaptions(state.context, state.ports)).status, "WAITING_TIMESTAMPS");
  assert.deepEqual(state.calls, []);
  const other = fixture();
  other.document().clips.push({ ...structuredClone(other.document().clips[0]!), id: "unbound", hfId: "unbound", sceneId: undefined });
  assert.equal((await ensureProductionNativeCaptions(other.context, other.ports)).status, "REVIEW_REQUIRED");
  assert.equal(other.calls.includes("append"), false);
});

test("una fuente o timestamps desactualizados en el documento bloquean el append", async () => {
  for (const invalidate of [
    (state: ReturnType<typeof fixture>) => { state.document().narrativeScenes![0]!.scriptHash = "c".repeat(64); },
    (state: ReturnType<typeof fixture>) => { state.document().narrativeScenes![0]!.wordTimestamps![0]!.word = "Otro"; },
    (state: ReturnType<typeof fixture>) => { state.context.assets.voice_clips![0]!.asset_id = "22222222-2222-4222-8222-222222222222"; },
  ]) {
    const state = fixture();
    invalidate(state);
    assert.equal((await ensureProductionNativeCaptions(state.context, state.ports)).status, "REVIEW_REQUIRED");
    assert.equal(state.calls.includes("append"), false);
  }
});

test("capas manuales o importadas no se reemplazan", () => {
  for (const origin of ["MANUAL", "SRT", "VTT"] as const) {
    const state = fixture();
    const { clip, track } = createCompositionNativeOverlay({ document: state.document(), id: "manual", kind: "CAPTION", playheadSeconds: 0 });
    assert.ok(clip.source.type === "NATIVE_CAPTIONS");
    clip.source.origin = origin;
    const document = applyCompositionEditorPatches(state.document(), [{ type: "clip.add", clipId: clip.id, clip, ...(track ? { track } : {}) }]);
    const before = JSON.stringify(document);
    const plan = planProductionNativeCaptions(document, "auto-captions-item-1");
    assert.equal(plan.result.status, "REVIEW_REQUIRED");
    assert.equal(plan.operations, undefined);
    assert.equal(JSON.stringify(document), before);
  }
});

test("una capa editada, dividida o retirada requiere revisión y no se recrea", async () => {
  for (const operation of ["edit", "split", "remove"] as const) {
    const state = fixture();
    const previous = await ensureProductionNativeCaptions(state.context, state.ports);
    const document = state.document();
    const clip = document.clips.find(candidate => candidate.hfId === previous.hfId)!;
    assert.ok(clip.source.type === "NATIVE_CAPTIONS");
    if (operation === "edit") clip.source.cues[0]!.text = "Edición manual";
    if (operation === "remove") document.clips = document.clips.filter(candidate => candidate.id !== clip.id);
    if (operation === "split") {
      const split = applyCompositionEditorPatches(document, [{ type: "clip.split", clipId: clip.id, atSeconds: 11, newClipId: "right", newHfId: "right" }]);
      document.clips = split.clips;
    }
    const result = await ensureProductionNativeCaptions({ ...state.context, previous }, state.ports);
    assert.equal(result.status, "REVIEW_REQUIRED");
    assert.equal(state.calls.filter(call => call === "append").length, 1);
  }
});

test("un conflicto se informa sin reintentar ni sobrescribir otra edición", async () => {
  const state = fixture();
  let attempts = 0;
  state.ports.append = async () => { attempts++; throw state.conflict; };
  const before = JSON.stringify(state.document());
  const result = await ensureProductionNativeCaptions(state.context, state.ports);
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(attempts, 1);
  assert.equal(JSON.stringify(state.document()), before);
});

test("un guardado incierto se reconoce por lectura posterior sin duplicar", async () => {
  const state = fixture();
  const append = state.ports.append;
  state.ports.append = async input => { await append(input); throw new Error("respuesta perdida"); };
  const uncertain = await ensureProductionNativeCaptions(state.context, state.ports);
  assert.equal(uncertain.status, "FAILED");
  const recovered = await ensureProductionNativeCaptions({ ...state.context, previous: uncertain }, state.ports);
  assert.equal(recovered.status, "READY");
  assert.equal(state.calls.filter(call => call === "append").length, 1);
});

test("errores de acceso no alcanzan el append ni filtran detalles internos", async () => {
  const state = fixture();
  state.ports.prepare = async () => { throw new Error("organización distinta; detalle interno"); };
  const result = await ensureProductionNativeCaptions(state.context, state.ports);
  assert.equal(result.status, "FAILED");
  assert.doesNotMatch(result.detail, /detalle interno/);
  assert.deepEqual(state.calls, []);
});
