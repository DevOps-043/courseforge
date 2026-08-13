import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDeterministicPlan } from "../hyperframes-plan.service";

describe("HyperFrames internal plan", () => {
  it("constrains automatic output to a typed plan rather than HTML", () => {
    const plan = buildDeterministicPlan({ assetCount: 2, title: "Lección de prueba" });
    assert.equal(plan.title, "Lección de prueba");
    assert.equal(plan.durationSeconds, 12);
    assert.equal(plan.accentColor, "#38BDF8");
    assert.equal(plan.subtitle.includes("<"), false);
  });
});
