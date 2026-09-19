import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compositionEditorDocumentSchema } from "../composition-document.types";
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
