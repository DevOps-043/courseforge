import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateCourseDeckWithQualityGate } from "../generation/course-deck-generation-orchestrator.service";
import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import { validateCourseDeckQuality } from "../validation/course-deck-qa.service";
import { planDeckVisualAssets } from "../visuals/slide-visual-asset-planning.service";

describe("SofLIA - Engine slide deck generation", () => {
  it("builds a deck from existing script content without adding video-duration charts", () => {
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
    assert.equal(deck.slides.some((slide) => slide.chart), false);
    assert.equal(deck.slides.some((slide) => slide.id === "duration-distribution"), false);
    assert.equal(deck.sourceSnapshot.source, "component_content");
  });

  it("keeps avatar narration in speaker notes instead of visible slide content", () => {
    const narration = "Primero presentamos el objetivo con una explicacion larga que debe quedarse solo para el avatar.";
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                narration_text: narration,
                on_screen_text: "Objetivo\nTexto visible derivado del guion que no debe ganar a las fuentes.",
                section_number: 1,
                visual_notes: "Mapa visual del objetivo",
              },
            ],
            title: "Narracion separada",
          },
        },
        id: "component-1",
        sourcePack: {
          items: [{
            notes: "Los picos de energia cognitiva ayudan a programar tareas profundas en los momentos de mayor claridad mental.",
            ref: "source-energia-1",
            title: "Gestion de energia cognitiva",
          }],
          sourceRefs: ["source-energia-1"],
        },
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const generatedSlide = deck.slides.find((slide) => slide.id === "script-section-1");

    assert.equal(generatedSlide?.speakerNotes, narration);
    assert.equal(generatedSlide?.title, "Alinea tareas con energía cognitiva");
    assert.deepEqual(generatedSlide?.bodyBlocks[0]?.items, ["Los picos de energia cognitiva ayudan a programar tareas profundas en los momentos de mayor claridad mental."]);
  });

  it("keeps video production and b-roll directions out of visible slide copy", () => {
    const productionDirection = "Pantalla de titulo animada. Grafico abstracto de una onda de energia con picos y valles. Transicion a un reloj que acelera y desacelera.";
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                narration_text: "Explica como detectar los picos de energia cognitiva y asignar tareas profundas a esas ventanas.",
                on_screen_action: productionDirection,
                on_screen_text: productionDirection,
                section_number: 1,
                visual_notes: "Asset / B-roll con iconos representando sueno y ejercicio.",
              },
            ],
            title: "Picos de energia cognitiva",
          },
        },
        id: "component-1",
        sourcePack: {
          items: [{
            notes: "Los picos de energia cognitiva ayudan a programar tareas profundas en los momentos de mayor claridad mental.",
            ref: "source-energia-1",
            title: "Gestion de energia cognitiva",
          }],
          sourceRefs: ["source-energia-1"],
        },
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const html = renderCourseDeckHtml(deck);
    const visibleDeckText = deck.slides
      .flatMap((slide) => [
        slide.title,
        slide.subtitle || "",
        ...slide.bodyBlocks.flatMap((block) => block.kind === "bullets" ? block.items || [] : [block.text || ""]),
      ])
      .join(" ");

    assert.doesNotMatch(visibleDeckText, /Pantalla de titulo animada|Grafico abstracto|reloj que acelera|Asset \/ B-roll/i);
    assert.doesNotMatch(html, /ASSET \/ B-ROLL|Pantalla de titulo animada|Grafico abstracto|reloj que acelera/i);
    assert.doesNotMatch(visibleDeckText, /guion|storyboard|narracion/i);
    assert.match(visibleDeckText, /programar tareas profundas/i);
  });

  it("uses extracted source content instead of source page titles for visible slide copy", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                on_screen_text: "Improving Focus | Center for Teaching and Learning",
                section_number: 1,
              },
            ],
            title: "Enfoque y energia cognitiva",
          },
        },
        id: "component-1",
        sourcePack: {
          items: [{
            excerpt: "La atencion sostenida depende de proteger los recursos cognitivos frente a interrupciones constantes. Reducir distractores ayuda a sostener la atencion durante tareas de alta demanda cognitiva.",
            ref: "https://example.edu/focus",
            title: "Improving Focus | Center for Teaching and Learning",
          }],
          sourceRefs: ["https://example.edu/focus"],
        },
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const generatedSlide = deck.slides.find((slide) => slide.id === "script-section-1");
    const visibleText = [
      generatedSlide?.title || "",
      ...(generatedSlide?.bodyBlocks[0]?.items || []),
    ].join(" ");

    assert.doesNotMatch(visibleText, /Improving Focus|Center for Teaching and Learning/i);
    assert.doesNotMatch(generatedSlide?.title || "", /Concepto clave|Verificacion del aprendizaje/i);
    assert.match(visibleText, /atencion sostenida/i);
    assert.match(visibleText, /Reducir distractores ayuda/i);
  });

  it("does not use curation rationale as visible lesson content", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                on_screen_text: "Practica de enfoque\nCierra notificaciones antes de iniciar una tarea profunda.",
                section_number: 1,
              },
            ],
            title: "Enfoque y energia cognitiva",
          },
        },
        id: "component-1",
        sourcePack: {
          items: [{
            rationale: "Puede complementar la leccion con fundamentos cognitivos y estrategias practicas.",
            ref: "https://example.edu/generic-rationale",
            title: "Fuente de apoyo",
          }],
          sourceRefs: ["https://example.edu/generic-rationale"],
        },
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const generatedSlide = deck.slides.find((slide) => slide.id === "script-section-1");
    const visibleText = [
      generatedSlide?.title || "",
      ...(generatedSlide?.bodyBlocks[0]?.items || []),
    ].join(" ");

    assert.doesNotMatch(visibleText, /puede complementar|fundamentos cognitivos y estrategias practicas/i);
    assert.match(visibleText, /Cierra notificaciones/i);
  });

  it("does not plan worked examples when available evidence cannot fill them", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                on_screen_text: "Marco inicial\nLa atencion sostenida requiere proteger los recursos cognitivos.",
                section_number: 1,
              },
              {
                narration_text: "El avatar explica el contexto general sin dar un ejemplo aplicable.",
                section_number: 2,
              },
            ],
            title: "Enfoque y energia cognitiva",
          },
        },
        id: "component-1",
        sourcePack: {
          items: [{
            rationale: "Puede complementar la leccion con fundamentos cognitivos y estrategias practicas.",
            ref: "https://example.edu/generic-rationale",
            title: "Fuente de apoyo",
          }],
          sourceRefs: ["https://example.edu/generic-rationale"],
        },
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const secondContentSlide = deck.slides.find((slide) => slide.id === "script-section-2");
    const visibleText = [
      secondContentSlide?.title || "",
      ...(secondContentSlide?.bodyBlocks[0]?.items || []),
    ].join(" ");

    assert.equal(secondContentSlide?.type, "concept");
    assert.doesNotMatch(visibleText, /puede complementar|fundamentos cognitivos y estrategias practicas/i);
  });

  it("propagates evidence source refs into planned generated slides", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [
              {
                on_screen_text: "Ejemplo\nDecision con respaldo",
                section_number: 1,
              },
            ],
            title: "Fuentes trazables",
          },
        },
        id: "component-1",
        source_refs: ["source-1", "source-2"],
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });
    const generatedSlide = deck.slides.find((slide) => slide.id === "script-section-1");

    assert.deepEqual(
      generatedSlide?.validationHints.sourceRefs,
      ["component.content.script", "source-1", "source-2"],
    );
    assert.equal(generatedSlide?.type, "worked_example");
    assert.equal(generatedSlide?.renderHints?.layout, "split_reverse");
    assert.match(generatedSlide?.renderHints?.purpose || "", /apoyo visual/i);
  });

  it("plans decorative backgrounds separately from source-backed supporting visuals", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [{
              on_screen_text: "Aplicacion\nOrganiza tareas profundas en tus horas de mayor energia.",
              section_number: 1,
            }],
            title: "Gestion de energia",
          },
        },
        id: "component-1",
        source_refs: ["source-energia-1"],
        type: "VIDEO_THEORETICAL",
      },
      input: { locale: "es", template: "course-module" },
    });
    const planned = planDeckVisualAssets({ deckSpec: deck });
    const cover = planned.slides.find((slide) => slide.id === "cover");
    const content = planned.slides.find((slide) => slide.id === "script-section-1");

    assert.equal(cover?.visualAssets?.background?.purpose, "background");
    assert.deepEqual(cover?.visualAssets?.background?.sourceRefs, []);
    assert.equal(content?.visualAssets?.supporting?.purpose, "supporting");
    assert.deepEqual(content?.visualAssets?.supporting?.sourceRefs, ["source-energia-1"]);
  });

  it("renders ready visual assets and keeps their QA contract", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: { content: {}, id: "component-1", type: "VIDEO_THEORETICAL" },
      input: { locale: "es", template: "course-module" },
    });
    const planned = planDeckVisualAssets({ deckSpec: deck });
    const cover = planned.slides[0];
    assert.ok(cover?.visualAssets?.background);
    const background = {
      ...cover!.visualAssets!.background!,
      checksum: "a".repeat(64),
      status: "READY" as const,
      storagePath: "production-assets/slides/component-1/visuals/background/cover.png",
      url: "https://example.supabase.co/storage/v1/object/public/production-assets/cover.png",
    };
    const deckWithImage = {
      ...planned,
      slides: planned.slides.map((slide) => slide.id === cover?.id
        ? { ...slide, visualAssets: { ...slide.visualAssets!, background } }
        : slide),
    };
    const html = renderCourseDeckHtml(deckWithImage);
    const report = validateCourseDeckQuality({ deckSpec: deckWithImage, html });

    assert.match(html, /has-generated-background/);
    assert.match(html, /data-visual-asset=/);
    assert.equal(report.checks.visualAssets, true);
  });

  it("creates SVG charts only from instructional statistics", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          metrics: [
            { label: "Tareas profundas", value: 70 },
            { label: "Tareas administrativas", value: 30 },
          ],
          script: {
            sections: [
              {
                duration_seconds: 90,
                on_screen_text: "Distribucion de trabajo por demanda cognitiva",
                section_number: 1,
              },
            ],
            title: "Gestion de energia",
          },
        },
        id: "component-1",
        sourcePack: {
          items: [{
            notes: "La demanda cognitiva permite distinguir entre tareas profundas y tareas administrativas.",
            ref: "source-metrics-1",
            title: "Carga cognitiva y tareas",
          }],
          sourceRefs: ["source-metrics-1"],
        },
        type: "VIDEO_THEORETICAL",
      },
      input: {
        locale: "es",
        template: "course-module",
      },
    });

    const chartSlides = deck.slides.filter((slide) => slide.chart);
    assert.equal(chartSlides.length, 1);
    assert.equal(chartSlides[0]?.chart?.sourceRefs[0], "component.content.metrics");
    assert.equal(deck.slides.some((slide) => slide.id === "duration-distribution"), false);
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
    assert.equal(deck.slides[0]?.type, "data_explainer");
    assert.equal(deck.slides[0]?.renderHints?.layout, "data");
    assert.match(html, /class="deck-stage"/);
    assert.match(html, /s-split|s-center|data-slide/);
    assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.match(html, /--font-ui: Arial, Helvetica/);
    assert.match(html, /--font-display: Georgia/);
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

  it("fails QA for non-instructional video rhythm charts", () => {
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
            bullets: ["No debe ser parte del material visible."],
            chart: {
              id: "duration-distribution",
              points: [{ label: "S1", value: 12 }, { label: "S2", value: 20 }],
              sourceRefs: ["script.sections.duration_seconds"],
              title: "Ritmo del video",
              type: "bar",
              unit: "s",
            },
            title: "Distribucion de tiempo por seccion",
            type: "data_explainer",
          },
        ],
        locale: "es",
        template: "course-module",
      },
    });
    const report = validateCourseDeckQuality({
      deckSpec: deck,
      html: renderCourseDeckHtml(deck),
    });

    assert.equal(report.status, "FAIL");
    assert.equal(report.checks.chartContracts, false);
    assert.equal(report.findings.some((finding) => finding.code === "non_instructional_chart"), true);
  });

  it("fails QA when avatar narration is duplicated as visible content", () => {
    const narration = "Esta explicacion completa pertenece al avatar y no debe copiarse como contenido visible de la diapositiva porque satura el aprendizaje.";
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
            bullets: [narration],
            speakerNotes: narration,
            title: "Narracion duplicada",
          },
        ],
        locale: "es",
        template: "course-module",
      },
    });
    const report = validateCourseDeckQuality({
      deckSpec: deck,
      html: renderCourseDeckHtml(deck),
    });

    assert.equal(report.status, "FAIL");
    assert.equal(report.checks.narrationLeakage, false);
    assert.equal(report.findings.some((finding) => finding.code === "visible_avatar_narration"), true);
  });

  it("runs generation as explicit stages and returns a QA report", () => {
    const result = generateCourseDeckWithQualityGate({
      agentModels: {
        slideStrategy: {
          fallbackModel: "gemini-2.0-flash",
          modelName: "gpt-4o",
          scope: "Modulos: Slides",
          settingType: "SLIDES_STRATEGY_AGENT",
          temperature: 0.3,
          thinkingLevel: "medium",
        },
      },
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
        "evidence_pack",
        "slide_plan",
        "visual_direction",
        "chart_data",
        "html_render",
        "quality_gate",
      ],
    );
    assert.equal(result.qaReport.status, "PASS");
    assert.equal(result.deckSpec.designSystem.brandLabel, "SofLIA - Engine");
    assert.equal(result.stages[1]?.output.hasSourceRefs, false);
    assert.equal(result.stages[2]?.output.plannedSlideCount, 3);
    assert.equal(result.stages[2]?.output.modelName, "gpt-4o");
    assert.equal(result.stages[2]?.output.modelSettingType, "SLIDES_STRATEGY_AGENT");
    assert.equal(result.stages[3]?.output.assignmentCount, 3);
    assert.equal(result.deckSpec.slides[0]?.renderHints?.layout, "center");
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
