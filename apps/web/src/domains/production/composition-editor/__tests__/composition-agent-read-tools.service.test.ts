import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { buildCompositionAgentReadSnapshot } from "../composition-agent-read-tools.service";

test("returns scoped read results without source references and resolves selection", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "d".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000054", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/read-tool.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#00D4B3", durationSeconds: 8, subtitle: "Lectura", title: "Agente" },
  });
  const selectedClipId = document.clips[0]!.id;
  const snapshot = buildCompositionAgentReadSnapshot(document, selectedClipId);

  assert.deepEqual(snapshot.availableTools, ["get_composition", "get_selected_elements", "get_timeline_conflicts", "get_motion_catalog"]);
  assert.equal(snapshot.selectedElements[0]?.id, selectedClipId);
  assert.equal(snapshot.motionCatalog.presetIds.includes("FADE_IN"), true);
  assert.doesNotMatch(JSON.stringify(snapshot), /storagePath|publicUrl|productionAssetId|source/);
});
