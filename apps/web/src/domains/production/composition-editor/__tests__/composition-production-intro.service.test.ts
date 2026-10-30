import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { reconcileProductionIntroDocument } from "../composition-production-intro.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";

const productionAsset = {
  checksum: "a".repeat(64), durationSeconds: 12, fileSizeBytes: 42,
  mimeType: "video/mp4", productionAssetId: "11111111-1111-4111-8111-111111111111",
  publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/content.mp4",
  timelineRole: "BROLL" as const,
};

function baseDocument() {
  return createInitialCompositionDocument({
    animatedDeck: null, assets: [productionAsset],
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Intro" },
  });
}

test("coloca, reemplaza y retira una intro de Producción sin acumular clips", () => {
  const original = baseDocument();
  const content = original.clips[0]!;
  const withFirstIntro = reconcileProductionIntroDocument(original, {
    durationSeconds: 3, id: "22222222-2222-4222-8222-222222222222", label: "Apertura", mimeType: "video/mp4",
  });
  const firstIntro = withFirstIntro.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.placement === "INTRO")!;
  assert.equal(firstIntro.startSeconds, 0);
  assert.equal(firstIntro.durationSeconds, 3);
  assert.equal(withFirstIntro.clips.find((clip) => clip.id === content.id)?.startSeconds, 3);
  assert.equal(withFirstIntro.canvas.durationSeconds, 15);

  const withReplacement = reconcileProductionIntroDocument(withFirstIntro, {
    durationSeconds: 5, id: "33333333-3333-4333-8333-333333333333", label: "Nueva apertura", mimeType: "video/mp4",
  });
  assert.equal(withReplacement.clips.filter((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.placement === "INTRO").length, 1);
  assert.equal(withReplacement.clips.find((clip) => clip.id === content.id)?.startSeconds, 5);
  assert.equal(withReplacement.canvas.durationSeconds, 17);

  const withoutIntro = reconcileProductionIntroDocument(withReplacement, null);
  assert.equal(withoutIntro.clips.some((clip) => clip.source.type === "PRODUCTION_ASSET" && clip.source.placement === "INTRO"), false);
  assert.equal(withoutIntro.clips.find((clip) => clip.id === content.id)?.startSeconds, 0);
  assert.equal(withoutIntro.canvas.durationSeconds, 12);
});

test("reaplicar la misma intro conserva su capa, recorte y animación", () => {
  const intro = { durationSeconds: 3, id: "22222222-2222-4222-8222-222222222222", label: "Apertura", mimeType: "video/mp4" };
  const document = reconcileProductionIntroDocument(baseDocument(), intro);
  const edited = applyCompositionEditorPatches(document, [
    { clipId: "production-intro", type: "clip.layout", layout: { zIndex: 3 } },
    { clipId: "production-intro", type: "clip.trim", startSeconds: 0, durationSeconds: 2, sourceOffsetSeconds: 1 },
    { clipId: "production-intro", type: "animation.add-preset", animationId: "intro-fade", presetId: "FADE_IN", durationSeconds: 0.5, offsetSeconds: 0 },
  ]);
  assert.deepEqual(reconcileProductionIntroDocument(edited, intro), edited);
  const replaced = reconcileProductionIntroDocument(edited, { ...intro, id: "33333333-3333-4333-8333-333333333333" });
  assert.equal(replaced.motion.animations.length, 0);
  assert.notEqual(replaced.clips.find(clip => clip.id === "production-intro")?.layout.zIndex, 3);
});
