import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { resolveCompositionGroupColors } from "../composition-group-color.service";
import { hashCompositionDocument } from "../composition-document.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";

test("round-trip JSON conserva grupos y documentos anteriores siguen sin necesitarlos", () => {
  const ungrouped = createTwoClipDocument();
  const clipIds = ungrouped.clips.map((clip) => clip.id);
  const grouped = applyCompositionEditorPatches(ungrouped, [{
    clipIds,
    groupId: "group-round-trip",
    label: "Escena",
    type: "group.create",
  }]);

  const parsedUngrouped = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(ungrouped)));
  const parsedGrouped = compositionEditorDocumentSchema.parse(JSON.parse(JSON.stringify(grouped)));

  assert.equal(parsedUngrouped.groups, undefined);
  assert.deepEqual(parsedGrouped.groups, [{ clipIds, id: "group-round-trip", label: "Escena", order: 0 }]);
  assert.equal(hashCompositionDocument(parsedGrouped), hashCompositionDocument(grouped));
  assert.notEqual(hashCompositionDocument(parsedGrouped), hashCompositionDocument(parsedUngrouped));
});

test("restaurar historial conserva o elimina grupos según la versión elegida", () => {
  const ungrouped = createTwoClipDocument();
  const grouped = applyCompositionEditorPatches(ungrouped, [{
    clipIds: ungrouped.clips.map((clip) => clip.id),
    groupId: "group-history",
    type: "group.create",
  }]);
  const restoredGrouped = applyCompositionEditorPatches(ungrouped, [{
    document: grouped,
    type: "document.restore",
  }]);
  const restoredUngrouped = applyCompositionEditorPatches(grouped, [{
    document: ungrouped,
    type: "document.restore",
  }]);

  assert.deepEqual(restoredGrouped.groups, grouped.groups);
  assert.notEqual(restoredGrouped.groups, grouped.groups);
  assert.equal(restoredUngrouped.groups, undefined);
  assert.deepEqual(grouped.groups?.[0]?.clipIds, ungrouped.clips.map((clip) => clip.id));
});

test("asigna colores distintos a grupos que se cruzan y reutiliza el color después", () => {
  const document = createTwoClipDocument();
  const [firstClip, secondClip] = document.clips;
  const thirdClip = { ...firstClip!, id: "slide-third", hfId: "slide-third", startSeconds: 2 };
  const fourthClip = { ...secondClip!, id: "slide-fourth", hfId: "slide-fourth", startSeconds: 6 };
  const fifthClip = { ...firstClip!, id: "slide-fifth", hfId: "slide-fifth", startSeconds: 20 };
  const sixthClip = { ...secondClip!, id: "slide-sixth", hfId: "slide-sixth", startSeconds: 24 };
  document.clips = [firstClip!, secondClip!, thirdClip, fourthClip, fifthClip, sixthClip];
  document.groups = [
    { clipIds: [firstClip!.id, secondClip!.id], id: "group-overlap-one", order: 0 },
    { clipIds: [thirdClip.id, fourthClip.id], id: "group-overlap-two", order: 1 },
    { clipIds: [fifthClip.id, sixthClip.id], id: "group-after-overlap", order: 2 },
  ];

  const colors = resolveCompositionGroupColors(document);

  assert.notEqual(colors.get("group-overlap-one")?.key, colors.get("group-overlap-two")?.key);
  assert.equal(colors.get("group-overlap-one")?.key, colors.get("group-after-overlap")?.key);
});

function createTwoClipDocument() {
  return createInitialCompositionDocument({
    animatedDeck: {
      css: "",
      fonts: [],
      height: 1080,
      slides: [
        { animationCount: 0, classes: "slide", html: "<section>Uno</section>", index: 0, label: "Uno" },
        { animationCount: 0, classes: "slide", html: "<section>Dos</section>", index: 1, label: "Dos" },
      ],
      width: 1920,
    },
    assets: [],
    plan: { accentColor: "#38BDF8", durationSeconds: 8, subtitle: "Prueba", title: "Persistencia de grupos" },
  });
}
