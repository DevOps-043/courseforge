import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompositionPaletteKeyboardAction } from "../composition-command-palette-keyboard";

const input = { key: "Enter", isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, searchFocused: true };

test("Enter runs the active result only from the search, not the close button or an option", () => {
  assert.equal(resolveCompositionPaletteKeyboardAction(input), "RUN");
  assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, searchFocused: false }), null);
});
test("IME composition cannot execute, navigate or close the palette", () => {
  for (const key of ["Enter", "Escape", "ArrowDown", "ArrowUp", "k"]) {
    assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key, isComposing: true, ctrlKey: key === "k" }), null);
  }
});
test("plain arrows navigate, Escape and Ctrl/Cmd+K close", () => {
  assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key: "ArrowDown" }), "NEXT");
  assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key: "ArrowUp" }), "PREVIOUS");
  assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key: "Escape" }), "CLOSE");
  assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key: "K", ctrlKey: true }), "CLOSE");
  assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key: "k", metaKey: true }), "CLOSE");
});
test("modified editing keys retain native input behavior", () => {
  for (const key of ["Enter", "ArrowDown", "ArrowUp", "z", "c", "v", "Delete"]) {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
      assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key, ...modifier }), null);
    }
  }
  assert.equal(resolveCompositionPaletteKeyboardAction({ ...input, key: "Tab" }), null);
});
