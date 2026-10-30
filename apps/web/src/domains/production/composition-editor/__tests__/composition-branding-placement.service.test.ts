import assert from "node:assert/strict";
import test from "node:test";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { buildCompositionBrandingPlacementPatch } from "../composition-branding-placement.service";
import { reconcileAssemblyBrandingDocument, type AssemblyBrandingAsset } from "../composition-branding.service";
import { buildCompositionAutoOrganizePatch } from "../composition-auto-organize.service";
import { createInitialCompositionDocument } from "../composition-document.factory";

const ids = ["00000000-0000-4000-8000-000000000071", "00000000-0000-4000-8000-000000000072", "00000000-0000-4000-8000-000000000073"];

test("coloca branding sin acumular desplazamientos en ejecuciones repetidas", () => {
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: ids.map((productionAssetId, index) => ({ checksum: String(index + 1).repeat(64), durationSeconds: index === 1 ? 60 : index === 0 ? 10 : 8, fileSizeBytes: 1, mimeType: "video/mp4", productionAssetId, publicUrl: null, storageBucket: "production-assets", storagePath: `production-assets/${index}.mp4`, timelineRole: "BROLL" })), plan: { accentColor: "#38BDF8", durationSeconds: 60, subtitle: "Prueba", title: "Branding" } });
  const [intro, content, outro] = document.clips;
  const params = { document, intro: { clipId: intro!.id, durationSeconds: 10 }, outro: { clipId: outro!.id, durationSeconds: 8 } };
  const first = applyCompositionEditorPatches(document, buildCompositionBrandingPlacementPatch(params));
  const second = applyCompositionEditorPatches(first, buildCompositionBrandingPlacementPatch({ ...params, document: first }));
  assert.equal(first.clips.find((clip) => clip.id === content!.id)?.startSeconds, 10);
  assert.equal(first.clips.find((clip) => clip.id === outro!.id)?.startSeconds, 70);
  assert.equal(first.canvas.durationSeconds, 78);
  assert.deepEqual(second, first);
});

test("organizar conserva la ventana reservada para intro y outro", () => {
  const productionAssetId = "00000000-0000-4000-8000-000000000081";
  const asset = { checksum: "1".repeat(64), durationSeconds: 60, fileSizeBytes: 1, id: productionAssetId, label: "Avatar", mimeType: "video/mp4", productionAssetId, publicUrl: null, storageBucket: "production-assets", storagePath: "avatar.mp4", timelineRole: "AVATAR" as const, timelineVariant: "FULL" as const };
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [asset], plan: { accentColor: "#38BDF8", durationSeconds: 60, subtitle: "Prueba", title: "Organizar branding" } });
  const branded = reconcileAssemblyBrandingDocument(document, { intro: brandingAsset("00000000-0000-4000-8000-000000000082", "INTRO", 10_000), introSource: "ORG_DEFAULT", outro: brandingAsset("00000000-0000-4000-8000-000000000083", "OUTRO", 8_000) });
  const organized = applyCompositionEditorPatches(branded, buildCompositionAutoOrganizePatch({ assets: [asset], document: branded, includeCanvasDuration: false }).operations);
  assert.equal(organized.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET")?.startSeconds, 10);
  assert.equal(organized.clips.find((clip) => clip.source.type === "ASSEMBLY_BRAND_ASSET" && clip.source.placement === "OUTRO")?.startSeconds, 70);
  assert.equal(organized.canvas.durationSeconds, 78);
});

test("permite colocar sólo intro, sólo outro o ninguno sin lanzar errores", () => {
  const productionAssetId = "00000000-0000-4000-8000-000000000091";
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{ checksum: "1".repeat(64), durationSeconds: 60, fileSizeBytes: 1, mimeType: "video/mp4", productionAssetId, publicUrl: null, storageBucket: "production-assets", storagePath: "content.mp4", timelineRole: "AVATAR" }], plan: { accentColor: "#38BDF8", durationSeconds: 60, subtitle: "Prueba", title: "Branding parcial" } });
  const intro = brandingAsset("00000000-0000-4000-8000-000000000092", "INTRO", 10_000);
  const outro = brandingAsset("00000000-0000-4000-8000-000000000093", "OUTRO", 8_000);

  const introOnly = reconcileAssemblyBrandingDocument(document, { intro, introSource: "ORG_DEFAULT", outro: null });
  assert.equal(introOnly.canvas.durationSeconds, 70);
  assert.equal(introOnly.clips.filter((clip) => clip.source.type === "ASSEMBLY_BRAND_ASSET").length, 1);

  const outroOnly = reconcileAssemblyBrandingDocument(document, { intro: null, introSource: "ORG_DEFAULT", outro });
  assert.equal(outroOnly.canvas.durationSeconds, 68);
  assert.equal(outroOnly.clips.find((clip) => clip.source.type === "ASSEMBLY_BRAND_ASSET")?.startSeconds, 60);

  const none = reconcileAssemblyBrandingDocument(introOnly, { intro: null, introSource: "ORG_DEFAULT", outro: null });
  assert.equal(none.canvas.durationSeconds, 60);
  assert.equal(none.clips.some((clip) => clip.source.type === "ASSEMBLY_BRAND_ASSET"), false);
});

test("materializa intro/outro como referencias remotas sin duplicarlos", () => {
  const contentAssetId = "00000000-0000-4000-8000-000000000071";
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{ checksum: "1".repeat(64), durationSeconds: 60, fileSizeBytes: 1, mimeType: "video/mp4", productionAssetId: contentAssetId, publicUrl: null, storageBucket: "production-assets", storagePath: "content.mp4", timelineRole: "AVATAR" }], plan: { accentColor: "#38BDF8", durationSeconds: 60, subtitle: "Prueba", title: "Branding remoto" } });
  const intro = brandingAsset("00000000-0000-4000-8000-000000000072", "INTRO", 10_000);
  const outro = brandingAsset("00000000-0000-4000-8000-000000000073", "OUTRO", 8_000);
  const first = reconcileAssemblyBrandingDocument(document, { intro, introSource: "ORG_DEFAULT", outro });
  const second = reconcileAssemblyBrandingDocument(first, { intro, introSource: "ORG_DEFAULT", outro });

  assert.equal(first.canvas.durationSeconds, 78);
  assert.equal(first.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET")?.startSeconds, 10);
  assert.equal(first.clips.filter((clip) => clip.source.type === "ASSEMBLY_BRAND_ASSET").length, 2);
  assert.deepEqual(second, first);
});

function brandingAsset(id: string, kind: "INTRO" | "OUTRO", durationMilliseconds: number): AssemblyBrandingAsset {
  return { checksum: "a".repeat(64), durationMilliseconds, hasAudio: true, id, kind, mimeType: "video/mp4", name: `${kind}.mp4`, sourceHeight: 1080, sourceWidth: 1920, storageBucket: "production-assets", storagePath: `assembly-branding/${id}.mp4` };
}

test("editar capas y animaciones de branding sobrevive a reaplicar y reemplazar sólo el otro recurso", () => {
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{ checksum: "1".repeat(64), durationSeconds: 60, fileSizeBytes: 1, mimeType: "video/mp4", productionAssetId: ids[0]!, publicUrl: null, storageBucket: "production-assets", storagePath: "content.mp4", timelineRole: "AVATAR" }], plan: { accentColor: "#38BDF8", durationSeconds: 60, subtitle: "Prueba", title: "Capas de branding" } });
  const intro = brandingAsset(ids[1]!, "INTRO", 10_000);
  const outro = brandingAsset(ids[2]!, "OUTRO", 8_000);
  const branding = { intro, introSource: "ORG_DEFAULT" as const, outro };
  let edited = reconcileAssemblyBrandingDocument(document, branding);
  for (const clip of edited.clips.filter(clip => clip.source.type === "ASSEMBLY_BRAND_ASSET")) {
    edited = applyCompositionEditorPatches(edited, [
      { clipId: clip.id, type: "clip.layout", layout: { zIndex: 4, x: 18, opacity: 0.8 } },
      { clipId: clip.id, type: "clip.trim", startSeconds: clip.startSeconds, durationSeconds: 4, sourceOffsetSeconds: 1 },
      { clipId: clip.id, type: "animation.add-preset", animationId: `fade-${clip.id}`, presetId: "FADE_IN", durationSeconds: 0.5, offsetSeconds: 0 },
    ]);
  }
  const reapplied = reconcileAssemblyBrandingDocument(edited, branding);
  for (const clip of edited.clips.filter(clip => clip.source.type === "ASSEMBLY_BRAND_ASSET")) {
    const retained = reapplied.clips.find(candidate => candidate.id === clip.id)!;
    assert.deepEqual(retained.layout, clip.layout);
    assert.equal(retained.durationSeconds, 4);
    assert.equal(retained.sourceOffsetSeconds, 1);
  }
  assert.deepEqual(reapplied.motion, edited.motion);
  assert.deepEqual(reconcileAssemblyBrandingDocument(reapplied, branding), reapplied);
  const replacement = reconcileAssemblyBrandingDocument(reapplied, { ...branding, outro: brandingAsset(ids[0]!, "OUTRO", 6_000) });
  assert.equal(replacement.motion.animations.length, 1);
  assert.equal(replacement.motion.animations[0]?.target.clipId, "assembly-intro");
  const removed = reconcileAssemblyBrandingDocument(replacement, { ...branding, intro: null, outro: null });
  assert.equal(removed.motion.animations.length, 0);
});

test("pistas bloqueadas rechazan cambios de capa y animación del branding", () => {
  const document = createInitialCompositionDocument({ animatedDeck: null, assets: [{ checksum: "1".repeat(64), durationSeconds: 60, fileSizeBytes: 1, mimeType: "video/mp4", productionAssetId: ids[0]!, publicUrl: null, storageBucket: "production-assets", storagePath: "content.mp4", timelineRole: "AVATAR" }], plan: { accentColor: "#38BDF8", durationSeconds: 60, subtitle: "Prueba", title: "Branding bloqueado" } });
  const branded = reconcileAssemblyBrandingDocument(document, { intro: null, introSource: "ORG_DEFAULT", outro: brandingAsset(ids[1]!, "OUTRO", 8_000) });
  const clip = branded.clips.find(clip => clip.source.type === "ASSEMBLY_BRAND_ASSET")!;
  branded.tracks.find(track => track.id === clip.trackId)!.locked = true;
  assert.throws(() => applyCompositionEditorPatches(branded, [{ clipId: clip.id, type: "clip.layout", layout: { zIndex: 4 } }]), /bloqueado/);
  assert.throws(() => applyCompositionEditorPatches(branded, [{ clipId: clip.id, type: "animation.add-preset", animationId: "locked-fade", presetId: "FADE_IN", durationSeconds: 0.5, offsetSeconds: 0 }]), /bloqueado/);
});
