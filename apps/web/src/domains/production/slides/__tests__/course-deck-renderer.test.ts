import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";
import * as serverEnv from "../../../../lib/server/env";
import { synthesizeDeckVisibleCopy } from "../agents/visible-copy-synthesis-agent.service";
import { buildVisibleSlideCopy } from "../agents/visible-copy-agent.service";
import { isLikelyNarrationLeak } from "../content/slide-visible-content.service";
import { createSlideSourceAllocator, type SlideSourcePack } from "../content/slide-source-pack.service";
import {
  generateCourseDeckWithCopySynthesisQualityGate,
  generateCourseDeckWithQualityGate,
} from "../generation/course-deck-generation-orchestrator.service";
import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import { summarizeCourseDeckQaErrors, validateCourseDeckQuality } from "../validation/course-deck-qa.service";
import { planDeckVisualAssets } from "../visuals/slide-visual-asset-planning.service";
import { prepareAnimatedDeckForRemotion } from "../../validation/animated-deck-preprocessor.service";

describe("slide copy duplication regressions", () => {
  it("uses the same normalized comparison as QA for title and bullets", () => {
    const copy = buildVisibleSlideCopy({ visibleLines: ["Evaluación", "evaluacion.", "Comprueba el resultado"],
      fallbackTitle: "Prueba", fallbackBody: "Contenido pendiente de sintetizar", slideType: "concept" });
    assert.deepEqual(copy.bodyItems, ["Comprueba el resultado"]);
  });
  const sourcePack: SlideSourcePack = {
    items: [],
    sourceRefs: ["source-1"],
    insights: [{
      sourceRef: "source-1", type: "concept", title: "Escucha activa",
      bodyItems: ["Identifica los elementos del sonido."],
    }],
  };

  function draft(content: Record<string, unknown> = {}) {
    return buildCourseDeckSpecFromComponent({
      artifactId: "artifact-duplicates",
      component: { id: "component-duplicates", type: "VIDEO_THEORETICAL", sourcePack, content },
      input: { locale: "es", template: "course-module" },
    });
  }

  function synthesisDraft() {
    return draft({ script: { sections: [
      { section_number: 1, on_screen_text: "Licencias", narration_text: "Verifica los permisos de uso antes de compartir una obra." },
      { section_number: 2, on_screen_text: "Atribucion", narration_text: "Documenta la autoria y el origen de los recursos usados." },
    ] } });
  }

  function validResponse(deck: ReturnType<typeof draft>) {
    return { slides: deck.slides.map((slide, index) => ({
      id: slide.id, title: `Concepto educativo ${index + 1}`, bullets: slide.type === "cover"
        ? [`Criterio de aprendizaje ${index + 1}`]
        : [`Verifica los permisos del recurso para el caso ${index + 1}.`, `Documenta el origen antes de compartir la actividad ${index + 1}.`],
    })) };
  }

  function mockProvider(t: TestContext, responses: unknown[]) {
    t.mock.method(serverEnv, "getOptionalOpenAIApiKey", () => "test-key");
    t.mock.method(serverEnv, "getOptionalGeminiApiKey", () => null);
    const prompts: string[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      prompts.push(JSON.parse(String(init.body)).input);
      assert.ok(prompts.length <= responses.length, "Provider attempts must remain bounded");
      return new Response(JSON.stringify({ output_text: JSON.stringify(responses[prompts.length - 1]) }), {
        headers: { "content-type": "application/json" }, status: 200,
      });
    });
    return prompts;
  }

  it("rejects the template text and sparse explanation reported in production", () => {
    const deck = synthesisDraft();
    deck.slides[1] = { ...deck.slides[1]!, title: "Idea 18",
      subtitle: "Texto de resumen claro. Mensaje final motivador.",
      bodyBlocks: [{ kind: "bullets", items: ["Calificación Eficiente de Leads"] }] };
    deck.slides[2] = { ...deck.slides[2]!, title: "Mejorar la experiencia del cliente", subtitle: undefined,
      bodyBlocks: [{ kind: "bullets", items: ["Mejora Experiencia del Cliente"] }] };
    const qa = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });
    assert.equal(qa.status, "FAIL");
    assert.ok(qa.findings.some((finding) => finding.slideId === deck.slides[1]!.id && finding.code === "placeholder_visible_copy"));
    assert.ok(qa.findings.some((finding) => finding.slideId === deck.slides[2]!.id && finding.code === "insufficient_slide_explanation"));
  });

  it("repairs only sparse slides and preserves approved copy", async (t) => {
    const deck = synthesisDraft();
    const response = validResponse(deck);
    response.slides[2]!.bullets = ["Mejora la experiencia"];
    const prompts = mockProvider(t, [response, { slides: [validResponse(deck).slides[2]] }]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(prompts.length, 2);
    assert.match(prompts[1]!, /insufficient_slide_explanation/);
    assert.equal(result.trace.appliedSlideCount, deck.slides.length);
    assert.deepEqual(result.deckSpec.slides[1]!.bodyBlocks[0]!.items, response.slides[1]!.bullets);
  });

  it("does not inherit draft bullets when the model omits the explanation", async (t) => {
    const deck = synthesisDraft();
    const response = validResponse(deck);
    deck.slides[2]!.bodyBlocks = [{ kind: "bullets", items: response.slides[2]!.bullets }];
    response.slides[2]!.bullets = [];
    const prompts = mockProvider(t, [response, { slides: [validResponse(deck).slides[2]] }]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(prompts.length, 2);
    assert.match(prompts[1]!, /empty_slide_body/);
    assert.equal(result.trace.appliedSlideCount, deck.slides.length);
  });

  it("marks sparse fallback as rejected after bounded retries", async (t) => {
    const deck = synthesisDraft();
    deck.slides[2]!.subtitle = undefined;
    deck.slides[2]!.bodyBlocks = [{ kind: "bullets", items: ["Experiencia del cliente"] }];
    const response = validResponse(deck);
    response.slides[2]!.bullets = ["Experiencia del cliente"];
    mockProvider(t, [response, { slides: [response.slides[2]] }]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(result.trace.batches[0]!.slides[2]!.status, "REJECTED");
    assert.equal(validateCourseDeckQuality({ deckSpec: result.deckSpec, html: renderCourseDeckHtml(result.deckSpec) }).status, "FAIL");
  });

  it("accepts grounded paraphrases but rejects copied narration phrases", () => {
    const narration = "Verifica los permisos de uso antes de compartir una obra. Documenta la autoria y el origen de los recursos usados.";
    assert.equal(isLikelyNarrationLeak({ narration, visibleText: "Permisos y autoria: documenta el origen del recurso usado. Verifica si una obra permite compartir recursos y revisa los permisos antes de su uso." }), false);
    assert.equal(isLikelyNarrationLeak({ narration, visibleText: `Licencias: ${narration}` }), true);
  });

  it("renders generated bullets in the closing layout", () => {
    const deck = synthesisDraft();
    deck.slides = [{ ...deck.slides[1]!, renderHints: { ...deck.slides[1]!.renderHints, layout: "closing" },
      bodyBlocks: [{ kind: "bullets", items: ["Verifica permisos <antes> de publicar.", "Documenta el origen de cada recurso."] }] }];
    const html = renderCourseDeckHtml(deck);
    assert.ok(html.includes("<li>Verifica permisos &lt;antes&gt; de publicar.</li>"));
    assert.ok(html.includes("<li>Documenta el origen de cada recurso.</li>"));
  });

  it("retries truncated JSON within the same provider", async (t) => {
    const deck = synthesisDraft();
    t.mock.method(serverEnv, "getOptionalOpenAIApiKey", () => "test-key");
    t.mock.method(serverEnv, "getOptionalGeminiApiKey", () => null);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      output_text: ++calls === 1 ? '{"slides":[' : JSON.stringify(validResponse(deck)),
    }), { status: 200 }));
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(calls, 2);
    assert.equal(result.trace.appliedSlideCount, deck.slides.length);
  });

  it("fills every slide when expanded script sections repeat editorial numbers", async (t) => {
    const numbers = [1, 2, 3, 3, 3, 3, 4];
    const deck = draft({ script: { sections: numbers.map((section_number, index) => ({
      section_number, on_screen_text: `Tema ${index + 1}\nCriterio ${index + 1}\nAccion ${index + 1}`,
    })) } });
    assert.equal(deck.slides.length, 22);
    assert.equal(new Set(deck.slides.map((slide) => slide.id)).size, deck.slides.length);
    assert.ok(deck.slides.every((slide) => slide.renderHints?.layout));
    const response = validResponse(deck);
    const batches = Array.from({ length: Math.ceil(deck.slides.length / 4) }, (_, index) => ({
      slides: response.slides.slice(index * 4, index * 4 + 4),
    }));
    const prompts = mockProvider(t, batches);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck, sourcePack });
    assert.equal(prompts.length, batches.length);
    assert.equal(result.trace.appliedSlideCount, deck.slides.length);
    assert.equal(result.trace.batches.every((batch) => batch.applied), true);
    assert.equal(validateCourseDeckQuality({ deckSpec: result.deckSpec, html: renderCourseDeckHtml(result.deckSpec) }).status, "PASS");
  });

  it("keeps storyboard IDs unique even when take numbers repeat", () => {
    const deck = draft({ storyboard: [3, 3, 1].map((take_number, index) => ({ take_number, on_screen_text: `Idea ${index + 1}` })) });
    assert.deepEqual(deck.slides.map((slide) => slide.id), ["cover", "storyboard-1", "storyboard-2", "storyboard-3"]);
  });

  it("rejects duplicate IDs before contacting a model and reports them in QA", async (t) => {
    const deck = synthesisDraft();
    deck.slides[2]!.id = deck.slides[1]!.id;
    const prompts = mockProvider(t, []);
    await assert.rejects(synthesizeDeckVisibleCopy({ deckSpec: deck }), /duplicate_slide_id/);
    assert.equal(prompts.length, 0);
    const qa = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });
    assert.ok(qa.findings.some((finding) => finding.code === "duplicate_slide_id"));
    assert.equal(qa.checks.slideOrder, false);
  });

  it("preserves more than ten storyboard takes within the deck limit", () => {
    const deck = draft({ storyboard: Array.from({ length: 20 }, (_, index) => ({
      take_number: index + 1, on_screen_text: `Contenido educativo ${index + 1}`,
    })) });
    assert.equal(deck.slides.length, 21);
    assert.equal(deck.slides.at(-1)?.id, "storyboard-20");
  });

  it("fills a complete 24-slide deck in six batches preserving every ID", async (t) => {
    const deck = draft({ storyboard: Array.from({ length: 23 }, (_, index) => ({
      take_number: index + 1, on_screen_text: `Concepto educativo ${index + 1}`,
    })) });
    assert.equal(deck.slides.length, 24);
    const response = validResponse(deck);
    const batches = Array.from({ length: 6 }, (_, index) => ({ slides: response.slides.slice(index * 4, index * 4 + 4) }));
    const prompts = mockProvider(t, batches);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(prompts.length, 6);
    assert.equal(result.trace.appliedSlideCount, 24);
    assert.deepEqual(result.deckSpec.slides.map((slide) => slide.id), deck.slides.map((slide) => slide.id));
    assert.equal(validateCourseDeckQuality({ deckSpec: result.deckSpec, html: renderCourseDeckHtml(result.deckSpec) }).status, "PASS");
  });

  it("audits rejected fallback slides when no provider is configured", async (t) => {
    t.mock.method(serverEnv, "getOptionalOpenAIApiKey", () => null);
    t.mock.method(serverEnv, "getOptionalGeminiApiKey", () => null);
    const deck = synthesisDraft();
    deck.slides[1]!.bodyBlocks = [{ kind: "bullets", items: ["Contenido pendiente de sintetizar desde fuentes aprobadas."] }];
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    const audit = result.trace.batches[0]!.slides.find((slide) => slide.slideId === deck.slides[1]!.id)!;
    assert.equal(audit.status, "REJECTED");
    assert.ok(audit.findingCodes?.includes("placeholder_visible_copy"));
    assert.equal(audit.sourceReferenceKind, "PLANNED");
    assert.equal(result.trace.batches[0]!.attempts, 0);
  });

  it("bounds provider calls when the copy budget is exhausted", async (t) => {
    const prompts = mockProvider(t, []);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: synthesisDraft(), deadlineAt: Date.now() });
    assert.equal(prompts.length, 0);
    assert.match(result.trace.warning!, /synthesis_deadline_exceeded/);
  });

  it("retrieves relevant evidence beyond the first eighteen insights", async (t) => {
    const deck = synthesisDraft();
    deck.slides[1]!.speakerNotes = "Fotosintesis clorofila energia solar";
    const insights = Array.from({ length: 24 }, (_, index) => ({
      sourceRef: `ref-${index}`, type: "concept" as const, title: `Tema ${index}`, bodyItems: ["Otra materia"],
    }));
    insights[23] = { ...insights[23]!, title: "Fotosintesis clorofila", bodyItems: ["La energia solar interviene en la fotosintesis."] };
    const prompts = mockProvider(t, [validResponse(deck)]);
    await synthesizeDeckVisibleCopy({ deckSpec: deck, sourcePack: { items: [], sourceRefs: [], insights } });
    assert.match(prompts[0]!, /ref-23/);
  });

  it("repairs a duplicate across batches without rewriting the first batch", async (t) => {
    const deck = draft({ storyboard: Array.from({ length: 4 }, (_, index) => ({ take_number: index + 1, on_screen_text: `Contenido ${index}` })) });
    const good = validResponse(deck);
    const prompts = mockProvider(t, [
      { slides: good.slides.slice(0, 4) },
      { slides: [{ ...good.slides[0], id: deck.slides[4]!.id }] },
      { slides: [good.slides[4]] },
    ]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(prompts.length, 3);
    assert.match(prompts[2]!, /duplicate_slide_copy/);
    assert.equal(result.deckSpec.slides[0]!.title, good.slides[0]!.title);
    assert.equal(validateCourseDeckQuality({ deckSpec: result.deckSpec, html: renderCourseDeckHtml(result.deckSpec) }).status, "PASS");
  });

  for (const mode of ["script", "storyboard"] as const) {
    it(`does not cycle scarce evidence across a long ${mode} deck`, () => {
      const sections = Array.from({ length: 7 }, (_, index) => ({
        section_number: index + 1, take_number: index + 1,
        on_screen_text: `Tema educativo ${index + 1}\nCriterio de aprendizaje ${index + 1}`,
      }));
      const deck = draft(mode === "script" ? { script: { sections } } : { storyboard: sections });
      const qa = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });
      assert.equal(deck.slides.length, mode === "script" ? 15 : 8);
      assert.equal(qa.status, "FAIL", "Sparse deterministic drafts require synthesis before publication");
      assert.equal(qa.findings.some((finding) => finding.code === "duplicate_slide_copy"), false);
      assert.equal(deck.slides.filter((slide) => slide.title === "Escucha activa").length, 1);
    });
  }

  it("consumes distinct evidence across slide types and duplicate source entries", () => {
    const allocate = createSlideSourceAllocator({ ...sourcePack, insights: [
      sourcePack.insights![0]!,
      { ...sourcePack.insights![0]!, sourceRef: "duplicate-source" },
      { sourceRef: "practice", type: "practice", title: "Practica auditiva", bodyItems: ["Compara dos grabaciones."] },
    ] });
    assert.equal(allocate("worked_example")[0], "Practica auditiva");
    assert.equal(allocate("concept")[0], "Escucha activa");
    assert.deepEqual(allocate("worked_example"), []);
    assert.deepEqual(allocate("concept"), []);
  });

  it("repairs duplicate model copy once with slide IDs and section context", async (t) => {
    const deck = synthesisDraft();
    const duplicate = { slides: deck.slides.map((slide) => ({ id: slide.id, title: "Idea repetida", bullets: ["Contenido repetido"] })) };
    const prompts = mockProvider(t, [duplicate, { slides: validResponse(deck).slides.slice(1) }]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck, sourcePack });
    assert.equal(prompts.length, 2);
    assert.match(prompts[1]!, /duplicate_slide_copy/);
    assert.match(prompts[1]!, /script-section-2/);
    assert.match(prompts[0]!, /Documenta la autoria/);
    assert.equal(result.trace.provider, "openai");
    assert.equal(result.deckSpec.slides[0]!.title, "Idea repetida", "approved cover must remain untouched");
    assert.equal(validateCourseDeckQuality({ deckSpec: result.deckSpec, html: renderCourseDeckHtml(result.deckSpec) }).status, "PASS");
  });

  it("matches reordered responses by ID without another model call", async (t) => {
    const deck = synthesisDraft();
    const response = validResponse(deck);
    response.slides.reverse();
    const prompts = mockProvider(t, [response]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(prompts.length, 1);
    assert.deepEqual(result.deckSpec.slides.map((slide) => slide.title), ["Concepto educativo 1", "Concepto educativo 2", "Concepto educativo 3"]);
  });

  it("preserves mandatory language repair using the shared QA rules", async (t) => {
    const deck = synthesisDraft();
    const response = validResponse(deck);
    response.slides[1]!.title = "Learning with the evidence";
    response.slides[1]!.bullets = ["The students can improve their learning with practice."];
    const prompts = mockProvider(t, [response, { slides: [validResponse(deck).slides[1]] }]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(prompts.length, 2);
    assert.match(prompts[1]!, /visible_copy_wrong_language/);
    assert.equal(result.trace.provider, "openai");
  });

  it("leaves an invalid fallback blocked by the production quality gate", async (t) => {
    const params = {
      artifactId: "artifact-invalid",
      component: {
        id: "component-invalid", type: "VIDEO_THEORETICAL",
        content: { script: { sections: [
          { section_number: 1, on_screen_text: "Idea repetida\nCriterio comun" },
          { section_number: 2, on_screen_text: "Idea repetida\nCriterio comun" },
        ] } },
      },
      input: { locale: "es" as const, template: "course-module" as const },
    };
    const deck = buildCourseDeckSpecFromComponent(params);
    const response = { slides: deck.slides.map((slide) => ({ id: slide.id, title: "Idea repetida", bullets: ["Contenido repetido"] })) };
    const prompts = mockProvider(t, [response, response, response, response]);
    const result = await generateCourseDeckWithCopySynthesisQualityGate(params);
    assert.equal(prompts.length, 4);
    assert.equal(result.qaReport.status, "FAIL");
    assert.ok(result.qaReport.findings.some((finding) => finding.code === "duplicate_slide_copy"));
  });

  for (const invalid of ["missing", "duplicate-id", "unknown-id"] as const) {
    it(`repairs ${invalid} responses instead of silently accepting a partial deck`, async (t) => {
      const deck = synthesisDraft();
      const response = validResponse(deck);
      if (invalid === "missing") response.slides.pop();
      if (invalid === "duplicate-id") response.slides[1]!.id = response.slides[0]!.id;
      if (invalid === "unknown-id") response.slides[1]!.id = "unknown";
      const repairedResponse = validResponse(deck);
      if (invalid === "missing") repairedResponse.slides = repairedResponse.slides.slice(-1);
      const prompts = mockProvider(t, [response, repairedResponse]);
      const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
      assert.equal(prompts.length, 2);
      assert.equal(result.trace.appliedSlideCount, deck.slides.length);
    });
  }

  it("stops after one failed repair and keeps the final QA guard", async (t) => {
    const deck = synthesisDraft();
    const duplicate = { slides: deck.slides.map((slide) => ({ id: slide.id, title: "Idea repetida", bullets: ["Contenido repetido"] })) };
    const prompts = mockProvider(t, [duplicate, { slides: duplicate.slides.slice(1) }]);
    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck });
    assert.equal(prompts.length, 2);
    assert.equal(result.trace.provider, "deterministic_fallback");
    assert.deepEqual(result.deckSpec.slides.slice(1), deck.slides.slice(1));
    assert.equal(result.trace.appliedSlideCount, 1);
    assert.match(result.trace.warning!, /duplicate_slide_copy/);
    const invalidDeck = { ...deck, slides: deck.slides.map((slide) => ({ ...slide, title: "Idea repetida", subtitle: undefined, bodyBlocks: [{ kind: "bullets" as const, items: ["Contenido repetido"] }] })) };
    const qa = validateCourseDeckQuality({ deckSpec: invalidDeck, html: renderCourseDeckHtml(invalidDeck) });
    assert.equal(qa.status, "FAIL");
    assert.equal(qa.findings.filter((finding) => finding.code === "duplicate_slide_copy").length, 2);
    assert.ok(summarizeCourseDeckQaErrors(qa).includes("Contenido repetido entre diapositivas (2 incidencias)"));
  });
});

describe("SofLIA - Engine slide deck generation", () => {
  it("uses the approved light appearance by default", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-light",
      component: { content: {}, id: "component-light", type: "VIDEO_THEORETICAL" },
      input: { locale: "es", template: "course-module" },
    });
    const html = renderCourseDeckHtml(deck);

    assert.equal(deck.appearance, "light");
    assert.match(html, /data-appearance="light"/);
    assert.match(html, /--bg: #F3F7F8/);
    assert.match(html, /--shell: #FFFFFF/);
    assert.match(html, /--blue-deep: #0A2540/);
  });

  it("renders dark appearance from the same content while preserving brand accents", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-dark",
      component: { content: {}, id: "component-dark", type: "VIDEO_THEORETICAL" },
      input: { appearance: "dark", locale: "es", template: "course-module" },
    });
    const html = renderCourseDeckHtml(deck);

    assert.equal(deck.appearance, "dark");
    assert.match(html, /data-appearance="dark"/);
    assert.match(html, /--bg: #0F1419/);
    assert.match(html, /--shell: #1E2329/);
    assert.match(html, /--blue-deep: #FFFFFF/);
    assert.match(html, /--accent: #2d7d6e/i);
  });

  it("embeds both approved appearance palettes so a deck can switch without regeneration", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-dual-appearance",
      component: { content: {}, id: "component-dual-appearance", type: "VIDEO_THEORETICAL" },
      input: { locale: "es", template: "course-module" },
    });
    const html = renderCourseDeckHtml(deck);

    assert.match(html, /soflia-appearance-variables:v1/);
    assert.match(html, /:root\[data-appearance="light"\][\s\S]*--bg: #F3F7F8/);
    assert.match(html, /:root\[data-appearance="dark"\][\s\S]*--bg: #0F1419/);
  });

  it("keeps generated visual support copy within the compact reading budget", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: {
        content: {
          script: {
            sections: [{
              on_screen_text: "Enfoque\nUna explicacion deliberadamente extensa para comprobar que el texto visible se transforma en una pista breve y facilmente legible durante la narracion del video educativo.",
              section_number: 1,
            }],
          },
        },
        id: "component-1",
        type: "VIDEO_THEORETICAL",
      },
      input: { locale: "es", template: "course-module" },
    });
    const slide = deck.slides.find((item) => item.id === "script-section-1");

    assert.ok(slide);
    assert.ok(slide.title.length <= 58);
    assert.ok((slide.bodyBlocks[0]?.items || []).length <= 3);
    assert.ok((slide.bodyBlocks[0]?.items || []).every((item) => item.length <= 68));
  });

  it("fails QA when visible copy conflicts with the requested locale", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-1",
      component: { content: {}, id: "component-1", type: "VIDEO_THEORETICAL" },
      input: {
        customSlides: [{
          bullets: ["The learner should focus on this lesson and use the source with care."],
          title: "Focus and learning",
        }],
        locale: "es",
        template: "course-module",
      },
    });
    const report = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });

    assert.equal(report.status, "FAIL");
    assert.equal(report.checks.visibleLanguage, false);
    assert.equal(report.findings.some((finding) => finding.code === "visible_copy_wrong_language"), true);
  });

  it("keeps appearance variables usable through the animated-deck pipeline", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-embedded-appearance",
      component: { content: {}, id: "component-embedded-appearance", type: "VIDEO_THEORETICAL" },
      input: { appearance: "dark", locale: "es", template: "course-module" },
    });
    const prepared = prepareAnimatedDeckForRemotion(renderCourseDeckHtml(deck));

    assert.equal(prepared.deck.appearance, "dark");
    assert.match(prepared.css, /\.deck-scope\[data-appearance="light"\][\s\S]*--bg: #F3F7F8/);
    assert.match(prepared.css, /\.deck-scope\[data-appearance="dark"\][\s\S]*--bg: #0F1419/);
    assert.doesNotMatch(prepared.css, /\.deck-scope\s+:root/);
  });

  it("fails QA when learner-facing copy exposes production metadata", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-production-copy",
      component: { content: {}, id: "component-production-copy", type: "VIDEO_THEORETICAL" },
      input: {
        customSlides: [{
          bullets: ["Usar el B-roll indicado en el storyboard para esta toma."],
          title: "Instrucción interna",
        }],
        locale: "es",
        template: "course-module",
      },
    });
    const report = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });

    assert.equal(report.status, "FAIL");
    assert.equal(report.checks.productionMetadataLeakage, false);
    assert.equal(report.findings.some((finding) => finding.code === "visible_production_metadata"), true);
  });

  it("alternates compatible layouts for consecutive concept slides", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-layout-diversity",
      component: {
        content: {
          script: {
            sections: Array.from({ length: 5 }, (_, index) => ({
              on_screen_text: `Concepto ${index + 1}\nPrincipio educativo ${index + 1}`,
              section_number: index + 1,
            })),
            title: "Diversidad visual",
          },
        },
        id: "component-layout-diversity",
        type: "VIDEO_THEORETICAL",
      },
      input: { locale: "es", template: "course-module" },
    });
    const layouts = deck.slides
      .filter((slide) => slide.type === "concept")
      .map((slide) => slide.renderHints?.layout);

    assert.ok(new Set(layouts).size >= 2);
    assert.equal(layouts.some((layout, index) => index > 0 && layout === layouts[index - 1]), false);
    assert.equal(validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) }).checks.visualDiversity, true);
  });

  it("warns when an imported deck repeats one content layout", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-layout-warning",
      component: {
        content: {
          script: {
            sections: Array.from({ length: 4 }, (_, index) => ({
              on_screen_text: `Tema ${index + 1}\nIdea ${index + 1}`,
              section_number: index + 1,
            })),
          },
        },
        id: "component-layout-warning",
        type: "VIDEO_THEORETICAL",
      },
      input: { locale: "es", template: "course-module" },
    });
    const repeatedDeck = {
      ...deck,
      slides: deck.slides.map((slide) => slide.type === "concept"
        ? { ...slide, title: `Tema educativo ${slide.order}`, subtitle: undefined,
          bodyBlocks: [{ kind: "bullets" as const, items: ["Verifica los permisos del recurso antes de usarlo.", "Documenta su origen para conservar la atribucion."] }],
          renderHints: { ...slide.renderHints, layout: "split" as const } }
        : slide),
    };
    const report = validateCourseDeckQuality({
      deckSpec: repeatedDeck,
      html: renderCourseDeckHtml(repeatedDeck),
    });

    assert.equal(report.status, "WARN");
    assert.equal(report.checks.visualDiversity, false);
    assert.equal(report.findings.some((finding) => finding.code === "low_layout_diversity"), true);
  });

  it("records the synthesis stage while preserving explicitly supplied manual copy", async () => {
    const result = await generateCourseDeckWithCopySynthesisQualityGate({
      artifactId: "artifact-1",
      component: { content: {}, id: "component-1", type: "VIDEO_THEORETICAL" },
      input: {
        customSlides: [{
          bullets: ["Prioriza una sola accion visible."],
          title: "Prioriza la accion",
        }],
        locale: "es",
        template: "course-module",
      },
    });
    const synthesis = result.stages.find((stage) => stage.id === "visible_copy_synthesis");

    assert.equal(synthesis?.output.model, "manual-input");
    assert.deepEqual(result.deckSpec.slides[0]?.bodyBlocks[0]?.items, ["Prioriza una sola accion visible."]);
  });

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

  it("uses up to three explicit visual beats per script section", () => {
    const sourceInsights = Array.from({ length: 8 }, (_, index) => ({
      bodyItems: [`Evidencia concreta ${index + 1} para aplicar la leccion.`],
      sourceRef: `source-${index + 1}`,
      title: `Idea respaldada ${index + 1}`,
      type: "concept" as const,
    }));
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-duration",
      component: {
        content: {
          script: {
            sections: Array.from({ length: 4 }, (_, index) => ({
              duration_seconds: 60,
              on_screen_text: `Tema ${index + 1}\nAplicacion concreta ${index + 1}`,
              section_number: index + 1,
            })),
          },
        },
        id: "component-duration",
        sourcePack: { insights: sourceInsights, items: [], sourceRefs: sourceInsights.map((item) => item.sourceRef) },
        type: "VIDEO_THEORETICAL",
      },
      input: { locale: "es", template: "course-module" },
    });
    const report = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });

    assert.equal(deck.slides.length, 9);
    assert.equal(deck.slides.filter((slide) => slide.id.includes("-part-")).length, 4);
    assert.equal(deck.slides.every((slide) => slide.validationHints.sourceRefs.length > 0), true);
    assert.equal(report.findings.some((finding) => finding.code === "insufficient_slide_coverage"), false);
  });

  it("does not turn long avatar narration into additional visible slides", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-long-script",
      component: {
        content: {
          script: {
            sections: Array.from({ length: 7 }, (_, index) => ({
              duration_seconds: index === 0 ? 96 : 94,
              narration_text: `Paso ${index + 1}. Explicamos una decision concreta, su motivo y la comprobacion que confirma el resultado esperado.`,
              on_screen_text: `Paso ${index + 1}\nAccion y comprobacion`,
              section_number: index + 1,
            })),
          },
        },
        id: "component-long-script",
        sourcePack: { insights: [], items: [], sourceRefs: [] },
        type: "VIDEO_GUIDE",
      },
      input: { locale: "es", template: "course-module" },
    });
    const report = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });

    assert.equal(deck.slides.length, 15);
    assert.equal(Math.max(...deck.slides.map((slide) => slide.validationHints.targetSlideCount || 0)), 15);
    assert.equal(report.findings.some((finding) => finding.code === "insufficient_slide_coverage"), false);
  });

  it("does not render a card description when the item has no description", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-framework",
      component: { content: {}, id: "component-framework", type: "VIDEO_THEORETICAL" },
      input: {
        customSlides: [{ bullets: ["Yoga", "Atencion plena"], title: "Regula el estres", type: "objectives" }],
        locale: "es",
        template: "course-module",
      },
    });
    const html = renderCourseDeckHtml(deck);

    assert.match(html, /<h3>Yoga<\/h3>\s*<\/div>/);
    assert.doesNotMatch(html, /<h3>Yoga<\/h3>\s*<p>Yoga<\/p>/);
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
    assert.equal(generatedSlide?.bodyBlocks[0]?.items?.[0], "Los picos de energia cognitiva ayudan a programar tareas…");
    assert.ok((generatedSlide?.bodyBlocks[0]?.items?.[0].length || 0) <= 68);
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

  it("loads an organization-selected Google Font into the rendered deck", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-font",
      component: { content: {}, id: "component-font", type: "VIDEO_THEORETICAL" },
      input: { locale: "es", template: "course-module" },
    });
    deck.designSystem.font = {
      family: "Montserrat",
      source: "google",
      cssUrl: "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap",
    };
    const html = renderCourseDeckHtml(deck);

    assert.match(html, /fonts\.googleapis\.com\/css2\?family=Montserrat/);
    assert.match(html, /--font-display: 'Montserrat', Arial/);
    assert.match(html, /--font-ui: 'Montserrat', Arial/);
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
    assert.equal(result.qaReport.status, "FAIL", "The deterministic draft has not passed educational synthesis");
    assert.equal(result.deckSpec.designSystem.brandLabel, "SofLIA - Engine");
    assert.equal(result.stages[1]?.output.hasSourceRefs, false);
    assert.equal(result.stages[2]?.output.plannedSlideCount, 5);
    assert.equal(result.stages[2]?.output.modelName, "gpt-4o");
    assert.equal(result.stages[2]?.output.modelSettingType, "SLIDES_STRATEGY_AGENT");
    assert.equal(result.stages[2]?.output.executionMode, "DETERMINISTIC");
    assert.equal(result.stages[2]?.output.modelExecuted, false);
    assert.equal(result.stages[3]?.output.assignmentCount, 5);
    assert.equal(result.deckSpec.slides[0]?.renderHints?.layout, "center");
  });

  it("fails QA when an internal pending-content placeholder reaches visible copy", () => {
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-placeholder",
      component: { content: {}, id: "component-placeholder", type: "VIDEO_THEORETICAL" },
      input: {
        customSlides: [{
          bullets: ["Contenido pendiente de sintetizar desde fuentes aprobadas."],
          title: "Tema validado",
        }],
        locale: "es",
        template: "course-module",
      },
    });
    const report = validateCourseDeckQuality({ deckSpec: deck, html: renderCourseDeckHtml(deck) });

    assert.equal(report.status, "FAIL");
    assert.equal(report.findings.some((finding) => finding.code === "placeholder_visible_copy"), true);
  });

  it("synthesizes long decks in bounded slide batches", async (t) => {
    const localSourcePack: SlideSourcePack = { items: [], sourceRefs: [], insights: [] };
    const deck = buildCourseDeckSpecFromComponent({
      artifactId: "artifact-batches",
      component: {
        content: { script: { sections: Array.from({ length: 3 }, (_, index) => ({
          narration_text: `Narracion ${index + 1}`,
          on_screen_text: `Tema ${index + 1}\nCriterio ${index + 1}`,
          section_number: index + 1,
        })) } },
        id: "component-batches",
        sourcePack: localSourcePack,
        type: "VIDEO_THEORETICAL",
      },
      input: { locale: "es", template: "course-module" },
    });
    assert.ok(deck.slides.length > 4);
    const batchResponses = [
      deck.slides.slice(0, 4),
      deck.slides.slice(4),
    ].map((slides, batchIndex) => ({
      slides: slides.map((slide, index) => ({
        bullets: slide.type === "cover" ? ["Comprueba los permisos de uso"]
          : [`Comprueba los permisos antes de usar el recurso ${index + 1}.`, "Documenta el origen para conservar la atribucion."],
        id: slide.id,
        title: `Concepto del lote ${batchIndex + 1}-${index + 1}`,
      })),
    }));
    t.mock.method(serverEnv, "getOptionalOpenAIApiKey", () => "test-key");
    t.mock.method(serverEnv, "getOptionalGeminiApiKey", () => null);
    let requestCount = 0;
    t.mock.method(globalThis, "fetch", async () => {
      const response = batchResponses[requestCount++];
      return new Response(JSON.stringify({ output_text: JSON.stringify(response) }), {
        headers: { "content-type": "application/json" }, status: 200,
      });
    });

    const result = await synthesizeDeckVisibleCopy({ deckSpec: deck, sourcePack: localSourcePack });

    assert.equal(requestCount, 2);
    assert.equal(result.deckSpec.slides.length, deck.slides.length);
    assert.equal(result.trace.batches.length, 2);
    assert.deepEqual(
      result.trace.batches.flatMap((batch) => batch.slides.map((slide) => slide.slideId)),
      deck.slides.map((slide) => slide.id),
    );
    assert.equal(result.trace.batches.every((batch) => batch.applied && batch.attempts === 1), true);
    assert.equal(validateCourseDeckQuality({ deckSpec: result.deckSpec, html: renderCourseDeckHtml(result.deckSpec) }).status, "PASS");
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
