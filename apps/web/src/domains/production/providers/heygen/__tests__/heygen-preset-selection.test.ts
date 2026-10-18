import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildHeygenCourseQuery,
  resolveHeygenInitialPresetId,
  resolveHeygenScenePresets,
} from "../heygen-preset-selection";

const catalog = [{ id: "primero" }, { id: "default", is_default: true }, { id: "elegido" }];

describe("Preferencias de Producción al abrir HeyGen", () => {
  it("transmite avatar, voz y contexto sin perder caracteres del regreso", () => {
    const returnTo = "/empresa/admin/artifacts/curso?componentId=lección&tab=producción#escena";
    const query = new URLSearchParams(buildHeygenCourseQuery({
      avatarPresetId: "avatar elegido",
      voicePresetId: "voz elegida",
      componentId: "componente",
      returnTo,
    }).toString());
    assert.equal(query.get("avatarPresetId"), "avatar elegido");
    assert.equal(query.get("voicePresetId"), "voz elegida");
    assert.equal(query.get("componentId"), "componente");
    assert.equal(query.get("source"), "course");
    assert.equal(query.get("returnTo"), returnTo);
  });

  it("conserva compatibilidad sin preferencias", () => {
    const query = buildHeygenCourseQuery({ componentId: "componente", returnTo: "/admin" });
    assert.equal(query.has("avatarPresetId"), false);
    assert.equal(query.has("voicePresetId"), false);
    assert.equal(resolveHeygenInitialPresetId(catalog), "default");
  });

  it("prioriza la selección del catálogo sobre el default", () => {
    assert.equal(resolveHeygenInitialPresetId(catalog, "elegido"), "elegido");
  });

  it("descarta IDs ajenos o archivados y usa sólo opciones autorizadas", () => {
    assert.equal(resolveHeygenInitialPresetId(catalog, "otra-organización"), "default");
    assert.equal(resolveHeygenInitialPresetId([{ id: "primero" }], "archivado"), "primero");
    assert.equal(resolveHeygenInitialPresetId([], "otra-organización"), "");
  });

  it("materializa los valores visibles para guardar y generar sin mutar las escenas", () => {
    const clips = [{ id: "escena", script_text: "Texto", avatar_preset_id: "", voice_preset_id: "" }];
    const resolved = resolveHeygenScenePresets(clips, { avatarPresetId: "avatar", voicePresetId: "voz" });
    assert.deepEqual(resolved, [{ ...clips[0], avatar_preset_id: "avatar", voice_preset_id: "voz" }]);
    assert.equal(clips[0].avatar_preset_id, "");
    assert.equal(clips[0].voice_preset_id, "");
  });

  it("preserva las selecciones propias de cada escena y hereda cada campo por separado", () => {
    const clips = [
      { avatar_preset_id: "personalizado", voice_preset_id: "voz propia" },
      { avatar_preset_id: "otro" },
      { voice_preset_id: "otra" },
    ];
    assert.deepEqual(resolveHeygenScenePresets(clips, { avatarPresetId: "avatar", voicePresetId: "voz" }), [
      { avatar_preset_id: "personalizado", voice_preset_id: "voz propia" },
      { avatar_preset_id: "otro", voice_preset_id: "voz" },
      { avatar_preset_id: "avatar", voice_preset_id: "otra" },
    ]);
  });

  it("no inventa IDs cuando los catálogos están vacíos", () => {
    assert.deepEqual(resolveHeygenScenePresets([{}], { avatarPresetId: "", voicePresetId: "" }), [
      { avatar_preset_id: undefined, voice_preset_id: undefined },
    ]);
  });

  it("mantiene las preferencias en todo el recorrido de navegación a persistencia", () => {
    const query = buildHeygenCourseQuery({
      componentId: "componente",
      returnTo: "/empresa/admin/artifacts/curso",
      avatarPresetId: "elegido",
      voicePresetId: "voz ajena",
    });
    const selection = {
      avatarPresetId: resolveHeygenInitialPresetId(catalog, query.get("avatarPresetId")),
      voicePresetId: resolveHeygenInitialPresetId([{ id: "voz autorizada", is_default: true }], query.get("voicePresetId")),
    };
    const payload = JSON.parse(JSON.stringify({
      clips: resolveHeygenScenePresets([{}, { avatar_preset_id: "personalizado" }], selection),
    }));
    assert.deepEqual(payload.clips, [
      { avatar_preset_id: "elegido", voice_preset_id: "voz autorizada" },
      { avatar_preset_id: "personalizado", voice_preset_id: "voz autorizada" },
    ]);
  });
});
