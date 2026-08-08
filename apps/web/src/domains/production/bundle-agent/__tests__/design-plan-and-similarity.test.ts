import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachBundleDesignPlan,
  buildBundleDesignPlan,
  createBundleVisualFingerprint,
} from "../design-plan.service";
import {
  compareBundleVisualFingerprints,
  evaluateBundleVisualSimilarity,
} from "../visual-similarity.service";
import { DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF, type BundleAgentSpec } from "../types";

function createSpec(overrides: Partial<BundleAgentSpec> = {}): BundleAgentSpec {
  return {
    artifactKind: "video_bundle",
    title: "Plantilla de prueba",
    description: "Plantilla base para validar la planificación visual.",
    visualStyle: "estudio asimetrico con media educativa",
    creativeBrief: DEFAULT_BUNDLE_AGENT_CREATIVE_BRIEF,
    compositionId: "bundle-design-plan-test",
    durationFrames: 150,
    fps: 30,
    width: 1920,
    height: 1080,
    requiredAssets: ["audio", "avatar", "slides", "broll"],
    propsSchema: { type: "object", properties: {} },
    defaultProps: { accentColor: "#5B21B6" },
    changeSummary: "Spec de prueba.",
    ...overrides,
  };
}

describe("Bundle design plan and visual similarity", () => {
  it("honors an explicit template family over inferred prompt language", () => {
    const spec = createSpec({
      templateFamily: "editorial-rail",
      visualStyle: "cinematic inmersivo pantalla completa",
    });

    const plan = buildBundleDesignPlan(spec);

    assert.equal(plan.templateFamily, "editorial-rail");
    assert.equal(plan.source, "explicit-family");
    assert.equal(plan.layoutStrategy, "editorial");
  });

  it("uses a reference constraint before broad visual vocabulary", () => {
    const plan = buildBundleDesignPlan(createSpec({
      visualStyle: "cinematic with reference wireframe lock and avatar left",
    }));

    assert.equal(plan.templateFamily, "reference-frame");
    assert.equal(plan.source, "reference-constraint");
    assert.equal(plan.backgroundTreatment, "frame");
  });

  it("persists a resolved plan and public compiler props in the spec", () => {
    const spec = attachBundleDesignPlan(createSpec({ templateFamily: "floating-collage" }));

    assert.equal(spec.designPlan?.templateFamily, "floating-collage");
    assert.equal(spec.defaultProps.templateFamily, "floating-collage");
    assert.equal(spec.propsSchema.properties.templateFamily?.type, "string");
  });

  it("blocks an exact semantic duplicate and flags close compositions for review", () => {
    const base = attachBundleDesignPlan(createSpec({ templateFamily: "stacked-evidence" }));
    const exact = createBundleVisualFingerprint(base);
    const duplicateResult = evaluateBundleVisualSimilarity(exact, [exact]);
    assert.equal(duplicateResult.decision, "block");
    assert.equal(duplicateResult.highestScore, 1);

    const close = createBundleVisualFingerprint(attachBundleDesignPlan(createSpec({
      templateFamily: "stacked-evidence",
      defaultProps: { accentColor: "#0F766E" },
    })));
    const comparison = compareBundleVisualFingerprints(exact, close);
    const reviewResult = evaluateBundleVisualSimilarity(close, [exact]);

    assert.equal(comparison.score < 1, true);
    assert.equal(reviewResult.decision, "review");
    assert.equal(reviewResult.matchingTraits.includes("familia visual"), true);
  });

  it("allows a visual system with a different layout family", () => {
    const base = createBundleVisualFingerprint(attachBundleDesignPlan(createSpec({ templateFamily: "minimal-focus" })));
    const candidate = createBundleVisualFingerprint(attachBundleDesignPlan(createSpec({ templateFamily: "floating-collage" })));
    const result = evaluateBundleVisualSimilarity(candidate, [base]);

    assert.equal(result.decision, "allow");
    assert.equal(result.highestScore < result.threshold.review, true);
  });

  it("does not block a different temporal choreography as an exact visual duplicate", () => {
    const continuous = createBundleVisualFingerprint(attachBundleDesignPlan(createSpec({ templateFamily: "cinematic-field" })));
    const staged = createBundleVisualFingerprint(attachBundleDesignPlan(createSpec({
      templateFamily: "cinematic-field",
      timelinePlan: {
        version: 1,
        mode: "staged",
        opening: { asset: "avatar", durationFrames: 90, layout: "fullscreen" },
        main: { asset: "slides", layout: "fullscreen" },
        ending: { asset: "avatar", durationFrames: 90, layout: "fullscreen" },
        transition: "push-left",
        overlays: [],
      },
    })));
    const result = evaluateBundleVisualSimilarity(staged, [continuous]);

    assert.notEqual(result.decision, "block");
    assert.equal(result.highestScore < result.threshold.block, true);
  });
});
