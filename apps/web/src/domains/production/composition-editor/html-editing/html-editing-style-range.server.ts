import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { HtmlEditableManifest } from "./html-editing.contract";
import { HTML_EDITING_STYLE_RANGE_POLICY, formatHtmlEditingStyleRangeValue } from "./html-editing-style-range.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";

type RangeDeclaration = Extract<HtmlEditableManifest["elements"][number], { kind: "RANGE_TOKEN" }>;
export function readHtmlEditingStyleRangeDefault(node: Cheerio<AnyNode>, declaration: RangeDeclaration): number {
  const policy = HTML_EDITING_STYLE_RANGE_POLICY[declaration.range.property];
  const token = node.attr("data-courseforge-style-token");
  if ((token !== undefined && token !== declaration.tokenId)
    || node.css(policy.cssProperty)?.trim() !== formatHtmlEditingStyleRangeValue(declaration.range, declaration.range.defaultValue))
    throw new HtmlEditingValidationError("INVALID_SOURCE");
  return declaration.range.defaultValue;
}
export function applyHtmlEditingStyleRange(node: Cheerio<AnyNode>, declaration: RangeDeclaration, value: number) {
  const policy = HTML_EDITING_STYLE_RANGE_POLICY[declaration.range.property];
  node.attr("data-courseforge-style-token", declaration.tokenId)
    .css(policy.cssProperty, `${formatHtmlEditingStyleRangeValue(declaration.range, value)} !important`);
}
