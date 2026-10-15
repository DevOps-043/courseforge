import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEvidencePack } from "../agents/lesson-evidence-agent.service";
import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { courseChartSpecSchema, courseDeckSpecSchema, courseSlideSpecSchema,
  courseVisualAssetSchema, slideCitationSchema } from "../specs/course-deck.schema";
import { COURSE_SOURCE_REFERENCE_MAX_LENGTH, courseSourceReferenceSchema } from "../specs/course-source-reference.contract";
import { planDeckVisualAssets } from "../visuals/slide-visual-asset-planning.service";

function resourceUrl(length: number) {
  const prefix = "https://example.edu/resources/";
  return prefix + "a".repeat(length - prefix.length - 2) + "?v";
}

function buildDeck(reference: string, mode: "script" | "storyboard" = "script") {
  const sections = Array.from({ length: 13 }, (_, index) => ({
    section_number: index + 1,
    on_screen_text: `Concepto educativo ${index + 1}: comprueba la evidencia antes de tomar una decision.`,
  }));
  return buildCourseDeckSpecFromComponent({
    artifactId: "artifact-references",
    component: {
      id: "component-references", type: "VIDEO_THEORETICAL",
      source_refs: ["source-one", "source-two", reference],
      content: mode === "script" ? { script: { title: "Fuentes trazables", sections } }
        : { storyboard: sections.map((section) => ({ on_screen_text: section.on_screen_text })) },
    },
    input: { locale: "es", template: "course-module" },
  });
}

describe("course source reference contract", () => {
  for (const length of [120, 121, 180, 181, 2048, COURSE_SOURCE_REFERENCE_MAX_LENGTH]) {
    it(`preserves a ${length}-character URL across all reference schemas`, () => {
      const reference = resourceUrl(length);
      const deck = buildDeck(reference);
      assert.equal(deck.slides.length, 14);
      for (const slide of deck.slides) {
        assert.equal(slide.validationHints.sourceRefs[3], reference);
      }
      const planned = courseDeckSpecSchema.parse(planDeckVisualAssets({ deckSpec: deck }));
      assert.ok(planned.slides.some((slide) => slide.visualAssets?.supporting?.sourceRefs.includes(reference)));
      const chart = courseChartSpecSchema.parse({ id: "chart", title: "Resultados", type: "bar",
        sourceRefs: [reference], points: [{ label: "Grupo", value: 2 }] });
      assert.deepEqual(chart.sourceRefs, [reference]);
      assert.equal(slideCitationSchema.parse({ label: "Fuente", sourceRef: reference }).sourceRef, reference);
    });
  }

  it("preserves long references in storyboard generations", () => {
    const reference = resourceUrl(2048);
    const deck = buildDeck(reference, "storyboard");
    assert.equal(deck.slides.length, 14);
    assert.ok(deck.slides.every((slide) => slide.validationHints.sourceRefs.includes(reference)));
  });

  it("keeps distinct URLs that share the first 180 characters and deduplicates exact matches", () => {
    const prefix = resourceUrl(200);
    const references = [`${prefix}=one`, `${prefix}=two`];
    const evidence = buildEvidencePack({ component: {
      source_refs: [references[0], references[0]],
      sourcePack: { items: [], sourceRefs: [references[1]] },
      content: { sourceRefsUsed: references },
    } });
    assert.deepEqual(evidence.sourceRefs, references);
  });

  it("retains legacy IDs and paths, ignores missing metadata, and preserves internal characters", () => {
    const references = ["source-1", "component.content.script", "document  chapter"];
    const evidence = buildEvidencePack({ component: { source_refs: [null, 7, "", "  ", ...references] } });
    assert.deepEqual(evidence.sourceRefs, references);
    assert.equal(courseSourceReferenceSchema.parse(references[1]), references[1]);
  });

  it("rejects oversized references consistently instead of silently truncating them", () => {
    const reference = resourceUrl(COURSE_SOURCE_REFERENCE_MAX_LENGTH + 1);
    const schemas = [courseSourceReferenceSchema,
      courseSlideSpecSchema.shape.validationHints.unwrap().shape.sourceRefs.unwrap().element,
      courseVisualAssetSchema.shape.sourceRefs.unwrap().element,
      slideCitationSchema.shape.sourceRef];
    for (const schema of schemas) assert.equal(schema.safeParse(reference).success, false);
    assert.equal(courseChartSpecSchema.safeParse({ id: "chart", title: "Resultados", type: "bar",
      sourceRefs: [reference], points: [{ label: "Grupo", value: 2 }] }).success, false);
    assert.throws(() => buildEvidencePack({ component: { source_refs: [reference] } }));
    assert.throws(() => buildDeck(reference));
    for (const invalid of ["", "   ", null, 42]) {
      assert.equal(courseSourceReferenceSchema.safeParse(invalid).success, false);
    }
  });
});
