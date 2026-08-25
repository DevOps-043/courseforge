import assert from "node:assert/strict";
import test from "node:test";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { buildCompositionBrandingPlacementPatch } from "../composition-branding-placement.service";
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
