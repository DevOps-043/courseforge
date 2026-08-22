import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  resolveHyperframesSnapshotRenderProfile,
  summarizeHyperframesValidationIssues,
  validateHyperframesCompositionId,
} from "../hyperframes-request-validation";
import {
  getHyperframesRenderProfile,
  HYPERFRAMES_RENDER_PROFILES,
} from "../hyperframes-render-profiles";

test("accepts UUID composition identifiers and rejects route placeholders", () => {
  const compositionId = "10000000-0000-4000-8000-000000000001";

  assert.deepEqual(validateHyperframesCompositionId(compositionId), {
    data: compositionId,
    success: true,
  });
  assert.equal(validateHyperframesCompositionId("undefined").success, false);
  assert.equal(validateHyperframesCompositionId("").success, false);
});

test("summarizes nested validation failures without copying rejected input", () => {
  const parsed = z.object({
    clips: z.array(z.object({ label: z.string().max(3) })),
  }).safeParse({ clips: [{ label: "sensitive-long-label" }] });

  assert.equal(parsed.success, false);
  if (parsed.success) return;

  assert.deepEqual(summarizeHyperframesValidationIssues(parsed.error), [{
    code: "too_big",
    message: "Too big: expected string to have <=3 characters",
    path: "clips.0.label",
  }]);
  assert.doesNotMatch(
    JSON.stringify(summarizeHyperframesValidationIssues(parsed.error)),
    /sensitive-long-label/,
  );
});

test("keeps the render profile bound to the immutable snapshot", () => {
  const snapshot = {
    format: "mp4" as const,
    fps: 25 as const,
    quality: "standard" as const,
    resolution: "1080p" as const,
  };

  assert.deepEqual(
    resolveHyperframesSnapshotRenderProfile({ fps: 25, quality: "standard" }, snapshot),
    { data: snapshot, success: true },
  );
  assert.deepEqual(
    resolveHyperframesSnapshotRenderProfile({ fps: 30 }, snapshot),
    {
      message: "Los FPS solicitados no coinciden con el snapshot. Regenera el snapshot antes de renderizar.",
      success: false,
    },
  );
  assert.equal(
    resolveHyperframesSnapshotRenderProfile({ quality: "high" }, snapshot).success,
    false,
  );
  assert.equal(
    resolveHyperframesSnapshotRenderProfile({ resolution: "4k" }, snapshot).success,
    false,
  );
  assert.deepEqual(
    resolveHyperframesSnapshotRenderProfile({ fps: 25 }, undefined),
    {
      message: "Este snapshot usa un perfil de render anterior. Regenera el snapshot antes de enviarlo a HeyGen.",
      success: false,
    },
  );
});

test("exposes only avatar-safe user profiles and keeps high quality selectable", () => {
  assert.deepEqual(
    HYPERFRAMES_RENDER_PROFILES.map(({ format, fps, resolution }) => ({ format, fps, resolution })),
    HYPERFRAMES_RENDER_PROFILES.map(() => ({ format: "mp4", fps: 25, resolution: "1080p" })),
  );
  assert.equal(getHyperframesRenderProfile("balanced").quality, "standard");
  assert.equal(getHyperframesRenderProfile("high").quality, "high");
});
