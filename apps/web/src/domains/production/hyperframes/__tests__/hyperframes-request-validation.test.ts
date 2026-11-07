import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { hyperframesRenderProfileSchema } from "../hyperframes.types";
import { estimateHyperframesRenderBudget } from "../hyperframes-render-budget.service";
import {
  resolveHyperframesSnapshotRenderProfile,
  summarizeHyperframesValidationIssues,
  validateHyperframesCompositionId,
} from "../hyperframes-request-validation";
import {
  getHyperframesRenderProfile,
  HYPERFRAMES_RENDER_PROFILES,
  toHyperframesRenderSettings,
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

test("exposes distinct output levels and keeps historical profiles reproducible", () => {
  assert.deepEqual(
    HYPERFRAMES_RENDER_PROFILES.map(({ format, fps, resolution }) => ({ format, fps, resolution })),
    [
      { format: "mp4", fps: 24, resolution: "1080p" },
      { format: "mp4", fps: 25, resolution: "1080p" },
      { format: "mp4", fps: 30, resolution: "4k" },
      { format: "mov", fps: 25, resolution: "1080p" },
    ],
  );
  assert.equal(getHyperframesRenderProfile("balanced").quality, "standard");
  assert.equal(getHyperframesRenderProfile("high").quality, "high");
  assert.equal(getHyperframesRenderProfile("high").resolution, "1080p");
  assert.equal(getHyperframesRenderProfile("preview").fps, 25);
  assert.deepEqual(toHyperframesRenderSettings(getHyperframesRenderProfile("balanced")), {
    format: "mp4",
    fps: 25,
    quality: "standard",
    resolution: "1080p",
  });
  assert.equal(
    "id" in toHyperframesRenderSettings(getHyperframesRenderProfile("balanced")),
    false,
  );
});

test("pins new provider settings and rejects MOV with 4K", () => {
  const mov = toHyperframesRenderSettings(getHyperframesRenderProfile("mov-editing"));
  const high = toHyperframesRenderSettings(getHyperframesRenderProfile("high-4k"));
  assert.deepEqual(hyperframesRenderProfileSchema.parse(mov), mov);
  assert.deepEqual(hyperframesRenderProfileSchema.parse(high), high);
  assert.equal(hyperframesRenderProfileSchema.safeParse({ ...mov, resolution: "4k" }).success, false);
  assert.deepEqual(resolveHyperframesSnapshotRenderProfile({}, mov), { data: mov, success: true });
  assert.equal(resolveHyperframesSnapshotRenderProfile({ format: "mp4" }, mov).success, false);
  assert.equal(resolveHyperframesSnapshotRenderProfile({ resolution: "1080p" }, high).success, false);
});

test("estimates more bytes for 4K and blocks MOV estimates over the storage limit", () => {
  const estimate = (id: "high" | "high-4k" | "mov-editing") => estimateHyperframesRenderBudget({
    durationSeconds: 120,
    renderProfile: getHyperframesRenderProfile(id),
  });
  assert.ok(estimate("high-4k").estimatedOutputBytes > estimate("high").estimatedOutputBytes);
  assert.equal(estimate("mov-editing").requiresSegmentation, true);
});

test("removes manifest-only metadata before resolving a provider request", () => {
  const snapshotWithInternalId = {
    format: "mp4" as const,
    fps: 25 as const,
    id: "balanced",
    quality: "standard" as const,
    resolution: "1080p" as const,
  };

  assert.deepEqual(
    resolveHyperframesSnapshotRenderProfile({}, snapshotWithInternalId),
    {
      data: {
        format: "mp4",
        fps: 25,
        quality: "standard",
        resolution: "1080p",
      },
      success: true,
    },
  );
});
