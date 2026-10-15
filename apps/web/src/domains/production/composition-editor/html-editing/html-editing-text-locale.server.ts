import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";
import type { HtmlEditableManifest } from "./html-editing.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";
import type { HtmlEditingTextLocale } from "./html-editing-text-locale.contract";

export function readHtmlEditingTextLocaleDefault(node: Cheerio<AnyNode>, declaration: Extract<HtmlEditableManifest["elements"][number], { kind: "TEXT" }>): HtmlEditingTextLocale | undefined {
  const locale = declaration.localePolicy?.defaultLocale;
  if (locale && (node.attr("lang") !== locale.language || node.attr("dir") !== locale.direction))
    throw new HtmlEditingValidationError("INVALID_SOURCE");
  return locale;
}
