import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPOSITION_EDITOR_COMMANDS,
  filterCompositionEditorCommands,
} from "../composition-editor-command-palette";

test("keeps command identities unique and preserves registry order without a query", () => {
  assert.equal(new Set(COMPOSITION_EDITOR_COMMANDS.map((command) => command.id)).size, COMPOSITION_EDITOR_COMMANDS.length);
  assert.deepEqual(filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, ""), COMPOSITION_EDITOR_COMMANDS);
});

test("finds commands by accent-insensitive labels, keywords and shortcuts", () => {
  assert.deepEqual(
    filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, "areas seguras").map((command) => command.id),
    ["view.safe-areas"],
  );
  assert.equal(filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, "portapapeles")[0]?.id, "edit.copy");
  assert.equal(filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, "ctrl cmd v")[0]?.id, "edit.paste");
});

test("requires every search term and prioritizes label matches", () => {
  assert.deepEqual(filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, "abrir inexistente"), []);
  assert.equal(filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, "alternar")[0]?.category, "Vista");
});

test("exposes advanced layout and frame-editing commands", () => {
  assert.deepEqual(
    filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, "distribuir").map((command) => command.id),
    ["layout.distribute-horizontal", "layout.distribute-vertical"],
  );
  assert.deepEqual(
    filterCompositionEditorCommands(COMPOSITION_EDITOR_COMMANDS, "roll salida").map((command) => command.id),
    ["timing.roll-right-backward", "timing.roll-right-forward"],
  );
});
