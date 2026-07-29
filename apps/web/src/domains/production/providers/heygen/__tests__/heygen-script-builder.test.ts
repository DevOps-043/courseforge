import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHeygenScriptFromComponent } from "../heygen-script-builder";

describe("HeyGen script builder", () => {
  it("builds a talking-head script from video script sections", () => {
    const script = buildHeygenScriptFromComponent({
      componentContent: {
        script: {
          sections: [
            {
              duration_seconds: 8,
              narration_text: "Primero revisaremos el objetivo de aprendizaje.",
            },
            {
              duration_seconds: 12,
              narration_text: "Despues conectaremos ese objetivo con una practica concreta.",
            },
          ],
          title: "Introduccion al modulo",
        },
      },
      componentType: "VIDEO_THEORETICAL",
    });

    assert.equal(script.durationEstimateSeconds, 20);
    assert.equal(script.sectionCount, 2);
    assert.equal(script.title, "Introduccion al modulo");
    assert.match(script.scriptHash, /^[a-f0-9]{64}$/);
    assert.equal(
      script.scriptText,
      [
        "Primero revisaremos el objetivo de aprendizaje.",
        "Despues conectaremos ese objetivo con una practica concreta.",
      ].join("\n\n"),
    );
  });

  it("falls back to storyboard narration when script sections are absent", () => {
    const script = buildHeygenScriptFromComponent({
      componentContent: {
        storyboard: [
          {
            narration_text:
              "Esta demostracion muestra como validar un resultado antes de publicarlo.",
          },
        ],
        title: "Demo QA",
      },
      componentType: "VIDEO_DEMO",
    });

    assert.equal(script.sectionCount, 1);
    assert.equal(script.title, "Demo QA");
    assert.ok(script.durationEstimateSeconds > 0);
  });

  it("rejects components without enough narration", () => {
    assert.throws(
      () =>
        buildHeygenScriptFromComponent({
          componentContent: { script: { sections: [{ narration_text: "Hola" }] } },
          componentType: "VIDEO_GUIDE",
        }),
      /guion narrativo suficiente/,
    );
  });
});
