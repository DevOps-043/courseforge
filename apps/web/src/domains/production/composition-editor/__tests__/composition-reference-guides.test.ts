import assert from "node:assert/strict";
import test from "node:test";
import { COMPOSITION_REFERENCE_GUIDE_LIMIT, compositionReferenceGuidesSchema, readCompositionReferenceGuides, writeCompositionReferenceGuides } from "../composition-reference-guides";
import { createCompositionPreviewParentCommand, parseCompositionPreviewIframeMessage } from "../composition-preview-protocol";
import { classifyCompositionPreviewMessage } from "../composition-preview-message-policy";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { COMPOSITION_COMPILATION_TARGETS } from "../composition-compilation.types";

const guide = { id: "55555555-5555-4555-8555-555555555558", axis: "x" as const, ratio: 0.25, color: "#22d3ee" };

test("guías locales separan drafts y conservan posición, color y visibilidad", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const state = { visible: false, guides: [guide] };
  writeCompositionReferenceGuides(storage, "draft-a", state);
  assert.deepEqual(readCompositionReferenceGuides(storage, "draft-a"), state);
  assert.deepEqual(readCompositionReferenceGuides(storage, "draft-b"), { visible: true, guides: [] });
  assert.throws(() => readCompositionReferenceGuides({ getItem: () => "{" }, "draft-a"));
  assert.throws(() => readCompositionReferenceGuides({ getItem: () => "a".repeat(9_000) }, "draft-a"));
  assert.throws(() => writeCompositionReferenceGuides({ setItem: () => { throw new Error("Cuota agotada"); } }, "draft-a", state));
});

test("contrato rechaza límites, duplicados, CSS y entradas no finitas", () => {
  for (const invalid of [{ ...guide, color: "red;background:url(x)" }, { ...guide, ratio: NaN }, { ...guide, ratio: -1 },
    { ...guide, ratio: 1.01 }, { ...guide, axis: "z" }, { ...guide, extra: true }]) {
    assert.equal(compositionReferenceGuidesSchema.safeParse({ visible: true, guides: [invalid] }).success, false);
    assert.equal(createCompositionPreviewParentCommand({ type: "courseforge-composition-editor-guides", state: { visible: true, guides: [invalid] } } as never), null);
  }
  assert.equal(compositionReferenceGuidesSchema.safeParse({ visible: true, guides: [guide, guide] }).success, false);
  assert.equal(compositionReferenceGuidesSchema.safeParse({ visible: true, guides: Array(COMPOSITION_REFERENCE_GUIDE_LIMIT + 1).fill(guide) }).success, false);
});

test("mover una guía valida ID, ratio y generación del iframe", () => {
  const message = parseCompositionPreviewIframeMessage({ type: "courseforge-composition-guide-move", id: guide.id, ratio: 0.75, previewGeneration: 3 });
  assert.ok(message);
  const input = { message, generation: 3, documentHash: "a".repeat(64), failedGeneration: null, strictSync: true };
  assert.equal(classifyCompositionPreviewMessage(input).accept, true);
  assert.equal(classifyCompositionPreviewMessage({ ...input, generation: 4 }).accept, false);
  assert.equal(parseCompositionPreviewIframeMessage({ type: "courseforge-composition-guide-move", id: guide.id, ratio: Infinity }), null);
  assert.equal(parseCompositionPreviewIframeMessage({ type: "courseforge-composition-guide-move", id: "un selector", ratio: 0.5 }), null);
});

test("las guías son exclusivas del preview interactivo y no aparecen en render", async () => {
  const document = createInitialCompositionDocument({ animatedDeck: { css: "", fonts: [], height: 1080, width: 1920,
    slides: [{ animationCount: 0, classes: "slide", html: "<p>Guías editoriales</p>", index: 0, label: "Ejemplo" }] },
    assets: [], plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "", title: "Guías" } });
  const serialized = JSON.stringify(document);
  const preview = await compileCompositionPreview({ document, documentHash: "a".repeat(64), assetUrls: new Map() });
  assert.match(preview, /composition-reference-guides/);
  assert.match(preview, /referenceGuides.positions\(axis/);
  const render = await compileCompositionPreview({ document, documentHash: "a".repeat(64), assetUrls: new Map(), target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
  assert.doesNotMatch(render, /composition-reference-guide|courseforge-composition-editor-guides|courseforge-composition-guide-move/);
  assert.equal(JSON.stringify(document), serialized);
});
