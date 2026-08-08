import assert from "node:assert/strict";
import { describe, it } from "node:test";
import JSZip from "jszip";
import { normalizeGeneratedBundleSpec } from "../ai-spec-normalizer.service";
import { buildBundleBlueprint } from "../blueprint.service";
import { buildControlledBundleZip } from "../generation.service";
import { resolveGeminiBundleModel, resolveOpenAIBundleModel } from "../provider-model.service";
import { buildSpecFromConversation } from "../spec.service";

const STAGED_PROMPT = [
  "Quiero el avatar en pantalla completa.",
  "Despues de 5 segundos de margen al principio y al final del video, muestra las diapositivas en pantalla completa.",
  "Usa una transicion tipo empuje entre el avatar y las diapositivas.",
  "Sobre algunas diapositivas muestra el B-roll en la mitad derecha.",
  "Paleta de colores: morado, amarillo mostaza, gris y beige.",
].join(" ");

describe("Bundle Agent regression coverage", () => {
  it("compiles staged author intent, push motion, overlay selection and the complete requested palette", async () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [{ role: "USER", content_redacted: STAGED_PROMPT }],
    });
    const blueprint = buildBundleBlueprint(spec);

    assert.equal(spec.designPlan?.templateFamily, "cinematic-field");
    assert.equal(spec.designPlan?.transition, "push-left");
    assert.equal(spec.timelinePlan?.mode, "staged");
    assert.equal(spec.timelinePlan?.opening?.durationFrames, 150);
    assert.equal(spec.timelinePlan?.ending?.durationFrames, 150);
    assert.deepEqual(spec.timelinePlan?.main, { asset: "slides", layout: "fullscreen" });
    assert.deepEqual(spec.timelinePlan?.overlays[0], {
      asset: "broll",
      layout: "right-half",
      during: "main",
      slideSelection: "alternating",
      slideIndexes: [],
    });
    assert.equal(spec.creativeBrief.colorTokens.background, "#5B21B6");
    assert.equal(spec.creativeBrief.colorTokens.surface, "#F2E8D5");
    assert.equal(spec.creativeBrief.colorTokens.accent, "#D4A017");
    assert.equal(spec.creativeBrief.colorTokens.muted, "#6B7280");
    assert.equal((spec.defaultProps.designTokens as Record<string, unknown>).accentColor, "#D4A017");
    assert.equal(blueprint.fallbackDurationFrames, 330);

    const bundle = await buildControlledBundleZip(spec);
    const zip = await JSZip.loadAsync(bundle.buffer);
    const source = await zip.file("src/index.tsx")!.async("text");

    assert.match(source, /const generatedTimelinePlan: TimelinePlan = \{"version":1,"mode":"staged"/);
    assert.match(source, /"transition":"push-left"/);
    assert.match(source, /"accentColor":"#D4A017"/);
    assert.match(source, /function applyPushTransitionBox/);
    assert.doesNotMatch(source, /transform\s*:/);
  });

  it("keeps the established layout when the latest revision changes only colors", () => {
    const spec = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [
        { role: "USER", content_redacted: "Avatar a la derecha y slides a la izquierda." },
        { role: "TOOL", content_redacted: "Spec lista." },
        { role: "USER", content_redacted: "Cambia solamente la paleta a beige y amarillo mostaza." },
      ],
    });

    assert.equal(spec.designPlan?.templateFamily, "split-contrast");
    assert.equal(buildBundleBlueprint(spec).layout, "support-left-avatar-right");
    assert.equal(spec.creativeBrief.colorTokens.surface, "#F2E8D5");
    assert.equal(spec.creativeBrief.colorTokens.accent, "#D4A017");
  });

  it("repairs bounded model output before strict schema validation", () => {
    const fallback = buildSpecFromConversation({
      title: "Nuevo bundle Remotion",
      messages: [{ role: "USER", content_redacted: "Avatar a la izquierda con slides." }],
    });
    const candidate = {
      ...fallback,
      visualStyle: "Direccion visual demasiado extensa ".repeat(30),
      creativeBrief: {
        ...fallback.creativeBrief,
        visualReferences: ["Solo una referencia"],
      },
    };

    const normalized = normalizeGeneratedBundleSpec(candidate, fallback);

    assert.equal(normalized.visualStyle.length <= 240, true);
    assert.equal(normalized.creativeBrief.visualReferences.length >= 2, true);
    assert.deepEqual(normalized.authoringIntent, fallback.authoringIntent);
  });

  it("never sends an OpenAI model name to Gemini", () => {
    assert.equal(resolveGeminiBundleModel({
      configuredModel: "gpt-5.6-terra",
      configuredFallback: "gemini-2.5-flash",
    }), "gemini-2.5-flash");
    assert.equal(resolveGeminiBundleModel({
      configuredModel: "gpt-5.6-terra",
      configuredFallback: "gpt-4.1-mini",
      environmentModel: "gemini-2.0-flash",
    }), "gemini-2.0-flash");
    assert.equal(resolveOpenAIBundleModel({
      configuredModel: "gemini-2.5-flash",
      configuredFallback: "gpt-4.1-mini",
    }), "gpt-4.1-mini");
  });
});
