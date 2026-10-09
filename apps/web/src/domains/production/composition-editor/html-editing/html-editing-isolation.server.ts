import { createHash } from "node:crypto";
import type { CheerioAPI } from "cheerio";
import postcss from "postcss";
import type { HtmlEditingBinding } from "./html-editing.contract";
import { HtmlEditingValidationError } from "./html-editing-validation";
import { HTML_EDITING_COMPILATION_PROFILE } from "./html-editing-compilation-profile";

export const HTML_EDITING_SCOPE_ATTRIBUTE = "data-courseforge-html-scope";
export const HTML_EDITING_ISOLATION_VERSION = HTML_EDITING_COMPILATION_PROFILE.isolationVersion;
const outerStyle = "position:relative!important;width:100%!important;height:100%!important;contain:layout paint style!important;isolation:isolate!important;overflow:hidden!important";
const documentSelector = /(?:^|[\s>+~,(])(?:html|body)(?=[.#:\[\s>+~,)]|$)|:(?:root|scope)\b/i;
const trailingPseudoElement = /(::?(?:before|after|first-line|first-letter|marker))$/i;

function reject(): never { throw new HtmlEditingValidationError("INVALID_SOURCE"); }

/** Restrict the selector's SUBJECT, not just one comma branch or its first
 * ancestor. :is() retains the author's selector specificity; :where(scope)
 * contributes none. Pseudo-elements stay outside :is (where they are invalid).
 * Document-root selectors and nesting need a template adapter: fail explicitly
 * rather than silently dropping browser-invalid or semantically changed CSS. */
function scopedSelector(selector: string, scope: string): string {
  if (documentSelector.test(selector) || selector.includes("&")) reject();
  const pseudoElement = trailingPseudoElement.exec(selector)?.[1] ?? "";
  const subject = pseudoElement ? selector.slice(0, -pseudoElement.length).trim() : selector.trim();
  if (!subject || subject.includes("::") || /:(?:before|after|first-line|first-letter)\b/i.test(subject)) reject();
  return `:where(${scope}) :is(${subject})${pseudoElement}`;
}

/** Compiler-owned derivation only. Input has already passed the static source
 * and local resource policies. This mutates a parsed working copy, never source
 * bytes or native/editorial state. Both preview and render consume the result. */
export function isolateHtmlEditingFragment(fragment: CheerioAPI, binding: HtmlEditingBinding): string {
  const key = createHash("sha256").update(JSON.stringify([
    HTML_EDITING_ISOLATION_VERSION, binding.organizationId, binding.documentId,
    binding.clipId, binding.templateId, binding.templateVersion, binding.sourceSha256,
  ])).digest("hex");
  const scope = `[${HTML_EDITING_SCOPE_ATTRIBUTE}="${key}"]`;
  fragment("style").each((_index, element) => {
    const root = postcss.parse(fragment(element).text());
    root.walkRules(rule => {
      let ancestor = rule.parent;
      while (ancestor && ancestor.type !== "root") {
        if (ancestor.type === "rule") reject();
        ancestor = ancestor.parent;
      }
      rule.selectors = rule.selectors.map(selector => scopedSelector(selector, scope));
    });
    root.walkAtRules(rule => {
      if (rule.name.toLowerCase() !== "layer") return;
      // Layer names are global even when their selectors are local. Namespace
      // top-level names/order statements; nested layers require author review.
      let parent = rule.parent;
      while (parent && parent.type !== "root") {
        if (parent.type === "atrule" && parent.name.toLowerCase() === "layer") reject();
        parent = parent.parent;
      }
      if (rule.params.trim()) {
        const names = postcss.list.comma(rule.params);
        if (names.some(name => !/^[a-zA-Z_][a-zA-Z0-9_-]*(?:\.[a-zA-Z_][a-zA-Z0-9_-]*)*$/.test(name))) reject();
        rule.params = names.map(name => `cf_${key}.${name}`).join(", ");
      }
    });
    fragment(element).text(root.toString());
  });
  // Source rules only match descendants, never this trusted containing box.
  // Paint/layout containment also creates the containing block for positioned
  // descendants. !important prevents legacy neighbouring decks from changing
  // these protected properties through ordinary stylesheet rules.
  const wrapper = fragment(`<div ${scope.slice(1, -1)} style="${outerStyle}"></div>`);
  wrapper.append(fragment.root().contents().toArray());
  fragment.root().append(wrapper);
  return fragment.html();
}
