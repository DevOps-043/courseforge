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
