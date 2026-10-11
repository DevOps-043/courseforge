import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import { buildCourseDeckSpecFromComponent } from "../planning/course-deck-from-component.service";
import { buildCourseDeckEditableArtifact, CourseDeckEditorialError } from "../render/course-deck-editable-artifact.server";
import { renderCourseDeckHtml } from "../render/html-deck-renderer.service";
import type { CourseSlideSpec } from "../specs/course-deck.schema";
import { prepareInitialHtmlEditingRevision } from "../../composition-editor/html-editing/html-editing-bootstrap.server";
import { compileHtmlEditingFragment } from "../../composition-editor/html-editing/html-editing-compiler.server";

function fixture() {
  return buildCourseDeckSpecFromComponent({ artifactId: "editorial-fixture",
    component: { id: "editorial-component", type: "VIDEO_THEORETICAL", content: {},
      sourcePack: { items: [], sourceRefs: ["source-1"], insights: [{ sourceRef: "source-1", type: "concept",
        title: "Escucha activa", bodyItems: ["Identifica los elementos del sonido."] }] } },
    input: { locale: "es", template: "course-module" } });
}
const imageId = "00000000-0000-4000-8000-000000000011";

describe("generated course-deck editorial preparation", () => {
  for (const layout of ["center", "closing", "framework", "split", "split_reverse"] as const) {
    for (const appearance of ["light", "dark"] as const) {
      it(`compiles ${layout}/${appearance} with the unchanged editorial compiler`, () => {
        const deck = fixture();
        deck.appearance = appearance;
        deck.slides[0] = { ...deck.slides[0], type: "concept", subtitle: "Escucha antes de responder",
          bodyBlocks: [{ kind: "bullets", items: ["Reconocer: identifica el mensaje", "Responder: verifica tu comprensión"] }], renderHints: { layout } };
        const result = buildCourseDeckEditableArtifact(deck);
        assert.equal(result.preparation, "COMPILER_VALIDATED");
        assert.equal(result.activation, "REQUIRES_AUTHORIZED_DRAFT_REGISTRATION");
        const fragment = result.fragments[0];
        assert.ok(fragment.template.elements.length >= 3);
        assert.equal(fragment.template.sourceSha256, createHash("sha256").update(fragment.html).digest("hex"));
        assert.equal(/<script|@keyframes|@import|animation\s*:|transition\s*:|backdrop-filter:\s*(?:blur|url)/i.test(fragment.html), false);
        const parsed = load(fragment.html, {}, false);
        assert.equal(parsed(`.deck-scope[data-appearance="${appearance}"] > .deck-stage > section.slide.active`).length, 1);
        for (const field of fragment.template.elements) assert.equal(parsed(`[id="${field.elementId}"]`).length, 1);
      });
    }
  }
  it("keeps field identities across copy edits and separates source hashes", () => {
    const deck = fixture();
    const before = buildCourseDeckEditableArtifact(deck);
    deck.slides[0].title = "Otro título";
    const after = buildCourseDeckEditableArtifact(deck);
    assert.deepEqual(before.fragments[0].template.elements, after.fragments[0].template.elements);
    assert.notEqual(before.fragments[0].template.sourceSha256, after.fragments[0].template.sourceSha256);
    assert.notEqual(before.fragments[0].template.templateId, after.fragments[0].template.templateId);
    assert.deepEqual(after, buildCourseDeckEditableArtifact(deck));
  });
  it("binds image slots to registry UUIDs without retaining external URLs", () => {
    const deck = fixture();
    deck.slides[0].renderHints = { layout: "split" };
    deck.slides[0].visualAssets = { background: null, supporting: { id: "support-slot", status: "READY",
      url: "https://example.invalid/image.png", purpose: "supporting", altText: "Ejemplo", prompt: "example",
      promptHash: "a".repeat(64), reason: "educational", sourceRefs: [],
      slot: { id: "supporting", placement: "image_pane", purpose: "supporting" } } };
    assert.throws(() => buildCourseDeckEditableArtifact(deck), (error: unknown) =>
      error instanceof CourseDeckEditorialError && error.code === "IMAGE_BINDING_MISSING");
    const result = buildCourseDeckEditableArtifact(deck, new Map([["support-slot", imageId]]));
    assert.match(result.fragments[0].html, new RegExp(`conformance-media/${imageId}`));
    assert.doesNotMatch(result.fragments[0].html, /https:\/\//);
    assert.deepEqual(result.fragments[0].usedAssetIds, [imageId]);
  });
  it("declares typed chart data using the existing chart renderer", () => {
    const deck = fixture();
    deck.slides[0].chart = { id: "chart-one", type: "bar", title: "Resultados", sourceRefs: [],
      points: [{ label: "Antes", value: 20 }, { label: "Después", value: 40 }] };
    const result = buildCourseDeckEditableArtifact(deck);
    assert.ok(result.fragments[0].template.elements.some(element => element.kind === "CHART"));
  });
  for (const chartType of ["line", "area", "proportion"] as const) {
    it(`compiles a typed ${chartType} chart without a second renderer`, () => {
      const deck = fixture();
      const metadata = { id: "chart-one", title: "Resultados", sourceRefs: [] };
      deck.slides[0].chart = chartType === "proportion"
        ? { ...metadata, type: chartType, label: "Avance", value: 20, total: 100 }
        : { ...metadata, type: chartType, series: [{ label: "Serie", points: [{ label: "Antes", value: 20 }, { label: "Después", value: 40 }] }] };
      const result = buildCourseDeckEditableArtifact(deck);
      assert.ok(result.fragments[0].template.elements.some(element => element.kind === "CHART" && element.chart.type === chartType));
    });
  }
  it("keeps all 24 slides compiler-validated and their identities independent", () => {
    const deck = fixture();
    deck.slides = Array.from({ length: 24 }, (_, index) => ({ ...deck.slides[0], id: `slide-${index + 1}`, order: index + 1 }));
    const result = buildCourseDeckEditableArtifact(deck);
    assert.equal(result.fragments.length, 24);
    const ids = result.fragments.flatMap(fragment => fragment.template.elements.map(field => field.elementId));
    assert.equal(new Set(ids).size, ids.length);
  });
  it("leaves markup-shaped educational code read-only without dropping its content", () => {
    const deck = fixture();
    deck.slides[0].renderHints = { layout: "split" };
    deck.slides[0].bodyBlocks = [{ kind: "code", text: "<div>Ejemplo</div>" }];
    const result = buildCourseDeckEditableArtifact(deck);
    assert.ok(result.readOnlyFields.some(field => field.reason === "UNSUPPORTED_TEXT_VALUE"));
    assert.match(result.fragments[0].html, /&lt;div&gt;Ejemplo&lt;\/div&gt;/);
    assert.doesNotMatch(result.fragments[0].html, /<pre|<code/);
  });
  it("keeps font dependencies explicit, without loading fonts or claiming activation", () => {
    const deck = fixture();
    deck.designSystem.font = { family: "Brand Sans", source: "google", cssUrl: "https://fonts.googleapis.com/css2?family=Brand+Sans" };
    const result = buildCourseDeckEditableArtifact(deck);
    assert.deepEqual(result.fontRequirements, [{ family: "Brand Sans", source: "google" }]);
    assert.doesNotMatch(result.fragments[0].html, /fonts\.googleapis|@font-face/);
    assert.equal(result.activation, "REQUIRES_AUTHORIZED_DRAFT_REGISTRATION");
  });
  it("does not apply legacy operational-note cleanup to educational text", () => {
    const deck = fixture();
    deck.slides[0].renderHints = { layout: "split" };
    deck.slides[0].bodyBlocks = [{ kind: "callout", text: "[1]" }];
    const result = buildCourseDeckEditableArtifact(deck);
    assert.ok(result.fragments[0].template.elements.some(element => element.kind === "TEXT" && element.elementId.includes("callout")));
    assert.match(result.fragments[0].html, /\[1\]/);
  });
  it("supports a real text override against the generated declaration", () => {
    const fragment = buildCourseDeckEditableArtifact(fixture()).fragments[0];
    const initial = prepareInitialHtmlEditingRevision({ sourceHtml: fragment.html, encodedTrustedTemplate: JSON.stringify(fragment.template),
      authoritativeAnchor: { organizationId: "00000000-0000-4000-8000-000000000001", documentId: "00000000-0000-4000-8000-000000000002",
        revisionId: "00000000-0000-4000-8000-000000000003", documentSha256: "0".repeat(64), clipId: "slide-test" },
      grantedAssetIds: [], imageSources: new Map() });
    const field = fragment.template.elements.find(element => element.kind === "TEXT")!;
    const compiled = compileHtmlEditingFragment({ sourceHtml: fragment.html, encodedManifest: JSON.stringify(initial.revision.manifest),
      encodedState: JSON.stringify({ ...initial.revision.state, overrides: [{ operation: "SET_TEXT", elementId: field.elementId, value: "Título editado" }] }),
      authoritativeBinding: initial.revision.manifest.binding, grantedAssetIds: [], imageSources: new Map() });
    assert.match(compiled.html, /Título editado/);
  });
  it("rejects duplicate identities and does not mutate the source model or presentation", () => {
    const deck = fixture();
    const original = structuredClone(deck);
    const presentation = renderCourseDeckHtml(deck);
    buildCourseDeckEditableArtifact(deck);
    assert.deepEqual(deck, original);
    assert.equal(renderCourseDeckHtml(deck), presentation);
    assert.match(presentation, /data-soflia-template-runtime/);
    deck.slides.push({ ...deck.slides[0], order: 2 } as CourseSlideSpec);
    assert.throws(() => buildCourseDeckEditableArtifact(deck), (error: unknown) =>
      error instanceof CourseDeckEditorialError && error.code === "DUPLICATE_SLIDE_ID");
  });
});
