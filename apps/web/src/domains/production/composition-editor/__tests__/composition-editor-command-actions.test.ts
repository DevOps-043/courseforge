import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  buildCompositionCommandPaletteItems,
  executeCompositionEditorCommand,
  type CompositionCommandPaletteContext,
  type CompositionCommandPaletteHandlers,
} from "../composition-editor-command-actions";
import { COMPOSITION_EDITOR_COMMANDS, type CompositionEditorCommandId } from "../composition-editor-command-palette";

function createCommandDocument() {
  return createInitialCompositionDocument({
    animatedDeck: null,
    assets: [0, 1, 2].map((index) => ({
      checksum: String(index + 1).repeat(64),
      durationSeconds: 4,
      fileSizeBytes: 4,
      hasAudio: false,
      mimeType: "video/mp4",
      productionAssetId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      publicUrl: null,
      storageBucket: "production-assets",
      storagePath: `production-assets/command-${index + 1}.mp4`,
      timelineRole: "BROLL" as const,
    })),
    plan: { accentColor: "#38BDF8", durationSeconds: 12, subtitle: "Prueba", title: "Comandos" },
  });
}

function createHarness(overrides: Partial<CompositionCommandPaletteContext> = {}) {
  const document = createCommandDocument();
  const calls: string[] = [];
  const handlers: CompositionCommandPaletteHandlers = {
    align: (alignment) => calls.push(`align:${alignment}`),
    copy: () => calls.push("copy"),
    delete: (ripple) => calls.push(`delete:${ripple}`),
    distribute: (axis) => calls.push(`distribute:${axis}`),
    duplicate: () => calls.push("duplicate"),
    openAssistant: () => calls.push("assistant"),
    openLibrary: () => calls.push("library"),
    openPresets: () => calls.push("presets"),
    paste: () => calls.push("paste"),
    redo: () => calls.push("redo"),
    roll: (edge, deltaFrames) => calls.push(`roll:${edge}:${deltaFrames}`),
    slide: (deltaFrames) => calls.push(`slide:${deltaFrames}`),
    toggleDirectEditing: () => calls.push("direct"),
    toggleGrid: () => calls.push("grid"),
    toggleInspector: () => calls.push("inspector"),
    toggleSafeAreas: () => calls.push("safe"),
    toggleSnap: () => calls.push("snap"),
    undo: () => calls.push("undo"),
  };
  const context: CompositionCommandPaletteContext = {
    agentProposalActive: false,
    canPaste: true,
    canRedo: true,
    canUndo: true,
    directEditingEnabled: false,
    document,
    frameStep: 5,
    gridVisible: false,
    inspectorAssistantActive: false,
    inspectorOpen: false,
    libraryOpen: true,
    presetsOpen: false,
    safeAreasVisible: false,
    saving: false,
    selectedClipIds: new Set(document.clips.map((clip) => clip.id)),
    snapEnabled: true,
    ...overrides,
  };
  return { calls, context, document, handlers, items: buildCompositionCommandPaletteItems(context) };
}

function requireItem(items: ReturnType<typeof buildCompositionCommandPaletteItems>, id: CompositionEditorCommandId) {
  const result = items.find((item) => item.id === id);
  assert.ok(result, `Missing command item ${id}`);
  return result;
}

test("builds one contextual item for every registered command", () => {
  const { items } = createHarness();
  assert.deepEqual(items.map((item) => item.id), COMPOSITION_EDITOR_COMMANDS.map((command) => command.id));
});

test("dispatches advanced layout and frame commands with explicit arguments", () => {
  const { calls, context, handlers } = createHarness();
  for (const id of [
    "layout.align-horizontal-center",
    "layout.distribute-vertical",
    "timing.slide-backward",
    "timing.roll-right-forward",
  ] satisfies CompositionEditorCommandId[]) {
    executeCompositionEditorCommand({ frameStep: context.frameStep, handlers, id });
  }
  assert.deepEqual(calls, ["align:HORIZONTAL_CENTER", "distribute:VERTICAL", "slide:-5", "roll:RIGHT:5"]);
});

test("disables mutations while saving but keeps view-only commands available", () => {
  const { items } = createHarness({ saving: true });
  assert.equal(requireItem(items, "edit.copy").enabled, false);
  assert.equal(requireItem(items, "layout.align-left").enabled, false);
  assert.equal(requireItem(items, "timing.slide-forward").enabled, false);
  assert.equal(requireItem(items, "view.grid").enabled, true);
});

test("enforces selection counts and locks before dispatching advanced commands", () => {
  const empty = createHarness({ selectedClipIds: new Set() }).items;
  assert.equal(requireItem(empty, "layout.align-left").enabled, false);
  assert.equal(requireItem(empty, "timing.slide-forward").enabled, false);

  const oneDocument = createCommandDocument();
  const one = createHarness({ document: oneDocument, selectedClipIds: new Set([oneDocument.clips[0]!.id]) }).items;
  assert.equal(requireItem(one, "layout.align-left").enabled, true);
  assert.equal(requireItem(one, "layout.distribute-horizontal").enabled, false);

  const lockedDocument = createCommandDocument();
  lockedDocument.tracks.find((track) => track.id === lockedDocument.clips[0]!.trackId)!.locked = true;
  const locked = createHarness({ document: lockedDocument, selectedClipIds: new Set([lockedDocument.clips[0]!.id]) }).items;
  assert.equal(requireItem(locked, "layout.align-left").enabled, false);
  assert.match(requireItem(locked, "layout.align-left").disabledReason || "", /Desbloquea/);
});
