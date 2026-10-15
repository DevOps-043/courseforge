import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { HtmlEditableManifest } from "./html-editing.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";

type VisibilityDeclaration = Extract<HtmlEditableManifest["elements"][number], { kind: "VISIBILITY" }>;
export function htmlEditingVisibleDisplay(declaration: VisibilityDeclaration) {
  return declaration.visibleDisplay.toLowerCase().replaceAll("_", "-");
}
/** A trusted template must make the slot's default display explicit. No browser
 * computed style, CSS-variable inference or silent default-layout conversion. */
export function readHtmlEditingVisibilityDefault(node: Cheerio<AnyNode>, declaration: VisibilityDeclaration): boolean {
  const display = node.css("display")?.replace(/\s*!important\s*$/i, "").trim().toLowerCase();
  if (display !== "none" && display !== htmlEditingVisibleDisplay(declaration)) throw new HtmlEditingValidationError("INVALID_SOURCE");
  if (node.attr("hidden") !== undefined && display !== "none") throw new HtmlEditingValidationError("INVALID_SOURCE");
  return display !== "none";
}
export function applyHtmlEditingVisibility(node: Cheerio<AnyNode>, declaration: VisibilityDeclaration, visible: boolean) {
  node.css("display", `${visible ? htmlEditingVisibleDisplay(declaration) : "none"} !important`);
  if (visible) node.removeAttr("hidden"); else node.attr("hidden", "");
  node.attr("aria-hidden", visible ? "false" : "true");
}
