import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { buildCompositionDurationRecalculationPatch } from "../composition-duration-recalculation.service";

const VOICE_ID = "00000000-0000-4000-8000-000000000061";

test("recalcula la duración sin modificar la posición de los clips", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{
      checksum: "a".repeat(64),
      durationSeconds: 300,
      fileSizeBytes: 10,
      mimeType: "audio/mpeg",
      productionAssetId: VOICE_ID,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: "production-assets/voice.mp3",
      timelineRole: "VOICE",
    }],
    plan: { accentColor: "#38BDF8", durationSeconds: 30, subtitle: "Prueba", title: "Duración" },
  });
  const voice = document.clips[0]!;
  voice.startSeconds = 14;
  voice.timingSource = "USER_EDITED";

  const result = buildCompositionDurationRecalculationPatch({
    assets: [{ durationSeconds: 300, timelineRole: "VOICE" }],
    document,
  });

  assert.deepEqual(result.resolution, { durationSeconds: 300, source: "voice" });
  assert.equal(result.operations[0]?.type, "composition.canvas-duration");
  assert.equal(result.operations[0]?.durationSeconds, 314);
  assert.equal(voice.startSeconds, 14);
});
