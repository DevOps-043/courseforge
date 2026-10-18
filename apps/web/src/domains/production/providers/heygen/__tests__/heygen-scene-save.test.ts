import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AvatarClip, MaterialAssets } from "../../../../materials/types/materials.types";
import { saveHeygenSceneEdits } from "../heygen-scene-save.client";
import { HeygenScenesService, assertSceneGenerationContract } from "../heygen-scenes.service";
import { HeygenClient } from "../heygen.client";
import { heygenGenerateClipsRequestSchema, heygenScenesPatchRequestSchema } from "../heygen.validators";

const componentId = "550e8400-e29b-41d4-a716-446655440000";
const draft: AvatarClip = { id: "manual-nueva", order: 2, origin: "manual", script_text: "", status: "DRAFT" };
const complete: AvatarClip = { id: "scene-1", order: 1, script_text: "Narración completa.", status: "DRAFT", expected_media_mode: "voice_only" };
const request = { componentId, avatarGenerationMode: "scene_clips" as const, clips: [complete, draft] };

describe("Contrato de guardado de escenas", () => {
  it("admite borradores vacíos y conserva el resto de las escenas", () => {
    const parsed = heygenScenesPatchRequestSchema.parse(request);
    assert.deepEqual(parsed.clips, request.clips);
    assert.equal(heygenScenesPatchRequestSchema.parse({ ...request, clips: [{ ...draft, script_text: "  " }] }).clips[0].script_text, "");
  });

  it("mantiene UUID, campos y estados estrictos", () => {
    assert.equal(heygenScenesPatchRequestSchema.safeParse({ ...request, organizationId: "ajena" }).success, false);
    assert.equal(heygenScenesPatchRequestSchema.safeParse({ ...request, componentId: "inválido" }).success, false);
    assert.equal(heygenScenesPatchRequestSchema.safeParse({ ...request, clips: [{ ...draft, status: "INVENTADO" }] }).success, false);
    assert.equal(heygenScenesPatchRequestSchema.safeParse({ ...request, clips: [{ ...draft, avatar_preset_id: "inválido" }] }).success, false);
  });

  it("no deja generar un borrador vacío seleccionado", () => {
    const parsed = heygenGenerateClipsRequestSchema.safeParse({
      componentId, clips: request.clips, clipIds: [draft.id], generationTarget: "voice_only",
    });
    assert.equal(parsed.success, false);
    if (!parsed.success) assert.deepEqual(parsed.error.issues[0].path, ["clips", 1, "script_text"]);
    assert.throws(() => assertSceneGenerationContract({
      clipIds: [draft.id], clips: [{ ...draft, expected_media_mode: "voice_only" }], generationTarget: "voice_only",
    }), /guion|texto|vacío/i);
  });

  it("no bloquea escenas completas por un borrador vacío no seleccionado", () => {
    const parsed = heygenGenerateClipsRequestSchema.parse({
      componentId, clips: request.clips, clipIds: [complete.id], generationTarget: "voice_only",
    });
    assert.deepEqual(assertSceneGenerationContract({
      clips: parsed.clips, clipIds: parsed.clipIds, generationTarget: parsed.generationTarget,
    }).map((clip) => clip.id), [complete.id]);
  });
});

describe("Transporte de guardado de escenas", () => {
  it("envía PATCH con el snapshot y devuelve sólo escenas confirmadas por el servidor", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      assert.equal(url, "/api/production/heygen/scenes");
      assert.equal(init?.method, "PATCH");
      assert.deepEqual(JSON.parse(String(init?.body)), request);
      assert.ok(init?.signal);
      return Response.json({ success: true, data: { clips: request.clips, voiceClips: [] } });
    };
    assert.deepEqual(await saveHeygenSceneEdits(request, fetchImpl), { clips: request.clips, voiceClips: [] });
  });

  it("no confirma éxito con una respuesta incompleta o escenas faltantes", async () => {
    for (const data of [{}, { clips: [] }, { clips: [{ id: "inválido" }] }]) {
      await assert.rejects(saveHeygenSceneEdits(request, async () => Response.json({ success: true, data })), /no confirmó/);
    }
  });

  it("conserva errores de autorización y no reintenta automáticamente", async () => {
    let attempts = 0;
    await assert.rejects(saveHeygenSceneEdits(request, async () => {
      attempts += 1;
      return Response.json({ success: false, error: "No tienes permisos para guardar escenas." }, { status: 403 });
    }), /No tienes permisos/);
    assert.equal(attempts, 1);
  });

  it("informa respuesta no JSON, error de red y timeout sin inventar confirmación", async () => {
    await assert.rejects(saveHeygenSceneEdits(request, async () => new Response("<html>Error</html>", { status: 502 })), /no estuvo disponible/);
    await assert.rejects(saveHeygenSceneEdits(request, async () => { throw new TypeError("Network error"); }), /conexión/);
    await assert.rejects(saveHeygenSceneEdits(request, async () => { throw new DOMException("Tiempo agotado", "TimeoutError"); }), /comprobarlo antes/);
  });
});

describe("Persistencia editorial y recarga", () => {
  it("envía cambios editoriales al RPC y conserva borradores y eliminación explícita", async () => {
    const previous = { ...complete, asset_name: "Anterior" };
    let assets: MaterialAssets = { avatar_clips: [previous] };
    const supabase = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { assets }, error: null }) }) }) }),
      rpc: async (name: string, parameters: Record<string, unknown>) => {
        assert.equal(name, "merge_material_component_scene_assets");
        assert.equal(parameters.p_preserve_authored_fields, false);
        assert.equal(parameters.p_component_id, componentId);
        assets = { ...assets, avatar_clips: parameters.p_avatar_clips as AvatarClip[], voice_clips: [] };
        return { data: assets, error: null };
      },
    };
    const client = new HeygenClient({ apiKey: "prueba-sin-red", fetchImpl: async () => { throw new Error("No debe consultar al proveedor al guardar."); } });
    const service = new HeygenScenesService(supabase as unknown as ConstructorParameters<typeof HeygenScenesService>[0], client);
    const changed = { ...previous, asset_name: "Actualizado", voice_speed: 1.2 };
    const saved = await service.saveSceneClips({ ...request, clips: [changed, draft] });
    assert.equal(saved.avatar_clips?.[0].asset_name, "Actualizado");
    assert.equal(saved.avatar_clips?.[0].voice_speed, 1.2);
    assert.ok(service.buildSceneClips({ componentContent: {}, existingClips: saved.avatar_clips }).some((clip) => clip.id === draft.id));
    const removed = await service.saveSceneClips({ ...request, clips: [changed, { ...draft, deleted: true }] });
    assert.ok(!service.buildSceneClips({ componentContent: {}, existingClips: removed.avatar_clips }).some((clip) => clip.id === draft.id));
  });
});
