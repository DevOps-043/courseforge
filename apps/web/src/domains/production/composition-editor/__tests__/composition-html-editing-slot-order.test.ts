import assert from "node:assert/strict";
import test from "node:test";
import { prepareHtmlEditingSlotMove } from "../composition-html-editing-slot-order.client";

const declaration = { kind: "SLOTS", elementId: "list", label: "List", itemIds: ["a", "b", "c"] };
test("UI moves either direction without mutating the declared or current order", () => {
  const itemIds = ["a", "b", "c"];
  assert.deepEqual(prepareHtmlEditingSlotMove({ declaration, itemIds, fromIndex: 0, toIndex: 2 }).itemIds, ["b", "c", "a"]);
  assert.deepEqual(prepareHtmlEditingSlotMove({ declaration, itemIds, fromIndex: 2, toIndex: 0 }).itemIds, ["c", "a", "b"]);
  assert.deepEqual(prepareHtmlEditingSlotMove({ declaration, itemIds, fromIndex: 1, toIndex: 1 }).itemIds, itemIds);
  assert.deepEqual(itemIds, ["a", "b", "c"]); assert.deepEqual(declaration.itemIds, itemIds);
});
test("UI rejects malformed indices and foreign membership", () => {
  for (const index of [-1, 0.5, 3, 128, NaN, Infinity]) {
    assert.throws(() => prepareHtmlEditingSlotMove({ declaration, itemIds: declaration.itemIds, fromIndex: index, toIndex: 0 }));
    assert.throws(() => prepareHtmlEditingSlotMove({ declaration, itemIds: declaration.itemIds, fromIndex: 0, toIndex: index }));
  }
  for (const itemIds of [["a", "b"], ["a", "b", "b"], ["a", "b", "foreign"], ["a", "b", "<script>"]])
    assert.throws(() => prepareHtmlEditingSlotMove({ declaration, itemIds, fromIndex: 0, toIndex: 1 }));
});
