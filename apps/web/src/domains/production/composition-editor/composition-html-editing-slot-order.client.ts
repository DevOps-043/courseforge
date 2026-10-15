import { z } from "zod";
import { HTML_EDITING_LIMITS, htmlEditingSlotsElementSchema, htmlEditingSlotOrderSchema,
  isHtmlEditingSlotPermutation, type HtmlEditingSetOverride } from "./html-editing/html-editing.contract";

const indexSchema = z.number().int().min(0).max(HTML_EDITING_LIMITS.slotItems - 1);
/** Pure UI intent builder; indices address only current declared slot members.
 * Server revalidates the full permutation under its own template/CAS authority. */
export function prepareHtmlEditingSlotMove(input: { declaration: unknown; itemIds: unknown; fromIndex: number; toIndex: number }):
  Extract<HtmlEditingSetOverride, { operation: "SET_SLOT_ORDER" }> {
  const declaration = htmlEditingSlotsElementSchema.parse(input.declaration), itemIds = htmlEditingSlotOrderSchema.parse(input.itemIds);
  const fromIndex = indexSchema.parse(input.fromIndex), toIndex = indexSchema.parse(input.toIndex);
  if (!isHtmlEditingSlotPermutation(declaration.itemIds, itemIds) || fromIndex >= itemIds.length || toIndex >= itemIds.length)
    throw new Error("HTML_EDITING_INVALID_SLOT_MOVE");
  const next = [...itemIds];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return { operation: "SET_SLOT_ORDER", elementId: declaration.elementId, itemIds: next };
}
