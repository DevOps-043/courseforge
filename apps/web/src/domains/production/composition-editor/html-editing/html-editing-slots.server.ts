import type { Cheerio } from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { isHtmlEditingSlotPermutation, type HtmlEditableManifest } from "./html-editing.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";

type SlotsDeclaration = Extract<HtmlEditableManifest["elements"][number], { kind: "SLOTS" }>;
/** Slot membership is fixed by source/manifest, never by a client's selector.
 * Every declared item must be a unique immediate child in the original order. */
export function readHtmlEditingSlotDefaults(node: Cheerio<AnyNode>, declaration: SlotsDeclaration): string[] {
  const children = node.children().toArray();
  const itemIds = children.map(child => child.attribs.id ?? "");
  if (itemIds.length !== declaration.itemIds.length || itemIds.some((id, index) => id !== declaration.itemIds[index]))
    throw new HtmlEditingValidationError("INVALID_SOURCE");
  return itemIds;
}
export function applyHtmlEditingSlotOrder(node: Cheerio<AnyNode>, declaration: SlotsDeclaration, itemIds: readonly string[]) {
  if (!isHtmlEditingSlotPermutation(declaration.itemIds, itemIds)) throw new HtmlEditingValidationError("VALUE_NOT_DECLARED");
  const children = node.children().toArray(), byId = new Map<string, Element>(children.map(child => [child.attribs.id, child]));
  if (children.length !== itemIds.length || itemIds.some(id => !byId.has(id))) throw new HtmlEditingValidationError("INVALID_SOURCE");
  // Keep non-element anchors (whitespace/comments/text) at their original slots.
  // Only whole, already validated subtrees move; no clone/HTML insertion occurs.
  let index = 0;
  const ordered = node.contents().toArray().map(child =>
    child.type === "tag" || child.type === "style" || child.type === "script" ? byId.get(itemIds[index++]!)! : child);
  node.contents().remove();
  for (const child of ordered) node.append(child);
}
