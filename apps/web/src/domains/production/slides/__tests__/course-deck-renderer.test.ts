import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateCourseDeckWithQualityGate } from "../generation/course-deck-generation-orchestrator.service";
import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import { validateCourseDeckQuality } from "../validation/course-deck-qa.service";

describe("SofLIA - Engine slide deck generation", () => {
  it("builds a deck from existing script content and adds a duration chart", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                duration_seconds: 12,
                narration_text: "Primero presentamos el objetivo.",
                on_screen_text: "Objetivo\nComprender el flujo completo",
                section_number: 1,
              },
              {
                duration_seconds: 20,
                narration_text: "Luego revisamos un ejemplo.",
                on_screen_text: "Ejemplo\nAplicacion paso a paso",
                section_number: 2,
              },
            ],
            title: "Flujo de prueba",
          },
        },
        id: "component-1",
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });

    assert.equal(deck.slides[0].type, "cover");
    assert.equal(deck.slides.some((slide) => slide.chart?.type === "bar"), true);
    assert.equal(deck.sourceSnapshot.source, "component_content");
  });

  it("renders escaped HTML, SVG charts and the SofLIA Deck template contract", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {},
        id: "component-1",
        type: "VIDEO_THEORETICAL",
      },
      input: {
        customSlides: [
          {
            bullets: ["<script>alert(1)</script>", "Dato propio"],
            chart: {
              id: "custom-chart",
              points: [{ label: "A", value: 10 }, { label: "B", value: -4 }],
              sourceRefs: ["manual"],
              title: "Grafica propia",
              type: "bar",
            },
            title: "Titulo <b>custom</b>",
          },
        ],
        locale: "es",
        template: "course-module",
      },
    });
    const html = renderCourseDeckHtml(deck);

    assert.match(html, /&lt;b&gt;custom&lt;\/b&gt;/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /class="cf-chart"/);
    assert.match(html, /class="deck-stage"/);
    assert.match(html, /s-split|s-center|data-slide/);
    assert.match(html, /Newsreader/);
    assert.match(html, /Inter\+Tight|Inter Tight/);
    assert.match(html, /--blue-deep: #0A2540/);
    assert.match(html, /data-soflia-template-runtime="soflia-deck"/);
    assert.doesNotMatch(html, /<script>alert/);
  });

  it("repairs mojibake in generated deck text before rendering HTML", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {},
        id: "component-1",
        type: "VIDEO_THEORETICAL",
      },
      input: {
        customSlides: [
          {
            bullets: ["TransiciÃ³n a un reloj", "EnergÃ­a cognitiva"],
            title: "Pantalla de tÃ­tulo",
          },
        ],
        locale: "es",
        template: "course-module",
      },
    });
    const html = renderCourseDeckHtml(deck);

    assert.match(html, /Pantalla de título/);
    assert.match(html, /Transición a un reloj/);
    assert.match(html, /Energía cognitiva/);
    assert.doesNotMatch(html, /tÃ­tulo|TransiciÃ³n|EnergÃ­a/);
  });

  it("allows the trusted SofLIA Deck runtime but rejects arbitrary scripts", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {},
        id: "component-1",
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const html = renderCourseDeckHtml(deck);
    const trustedReport = validateCourseDeckQuality({
      deckSpec: deck,
      html,
    });
    const unsafeReport = validateCourseDeckQuality({
      deckSpec: deck,
      html: `${html}<script>alert("x")</script>`,
    });

    assert.equal(trustedReport.checks.htmlSafety, true);
    assert.equal(unsafeReport.status, "FAIL");
    assert.equal(unsafeReport.checks.htmlSafety, false);
  });

  it("runs generation as explicit stages and returns a QA report", () => {
    const result = generateCourseDeckWithQualityGate({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                duration_seconds: 10,
                narration_text: "Presentamos el concepto.",
                on_screen_text: "Concepto\nIdea clave",
                section_number: 1,
              },
              {
                duration_seconds: 15,
                narration_text: "Aplicamos el concepto.",
                on_screen_text: "Aplicacion\nPaso practico",
                section_number: 2,
              },
            ],
          },
        },
        id: "component-1",
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        metadata: {
          brandLabel: "SofLIA - Engine",
        },
        template: "course-module",
      },
    });

    assert.deepEqual(
      result.stages.map((stage) => stage.id),
      [
        "deck_brief",
        "slide_plan",
        "chart_data",
        "visual_direction",
        "html_render",
        "quality_gate",
      ],
    );
    assert.equal(result.qaReport.status, "PASS");
    assert.equal(result.deckSpec.designSystem.brandLabel, "SofLIA - Engine");
  });

  it("fails QA when rendered HTML contains unsafe executable markup", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {},
        id: "component-1",
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const report = validateCourseDeckQuality({
      deckSpec: deck,
      html: `${renderCourseDeckHtml(deck)}<script>alert("x")</script>`,
    });

    assert.equal(report.status, "FAIL");
    assert.equal(report.checks.htmlSafety, false);
    assert.equal(report.findings.some((finding) => finding.code === "script_tag"), true);
  });
});
