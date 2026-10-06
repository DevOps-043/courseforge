import {createLocalHtmlResourceValidator} from "../html-editing/html-local-resource-policy.server";
import type {CompositionEditorDocument} from "../composition-document.types";

export const CONTROLLED_BROWSER_RESOURCE_POLICY = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; media-src 'self'; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Admission for frozen deck fragments, not a sandbox or a general HTML sanitizer. */
export function assertControlledDeckSourcesLocal(input: {
  document: CompositionEditorDocument;
  remoteToLocal: Map<string,string>;
  localFiles: ReadonlySet<string>;
  resolvedDeckFragments?: ReadonlyMap<string, string>;
}) {
  const {assertCss, assertFragment} = createLocalHtmlResourceValidator(input);
  if (input.document.deckStyles) {
    // Imported stylesheets need their own transitive materialization; a font binary is not CSS.
    if (input.document.deckStyles.fontUrls.length) throw new Error("CONTROLLED_RENDER_DECK_STYLESHEET_NOT_MATERIALIZED");
    assertCss(input.document.deckStyles.css);
  }
  for (const clip of input.document.clips) {
    if (clip.source.type !== "DECK_SLIDE") continue;
    assertFragment(input.resolvedDeckFragments?.get(clip.id) ?? clip.source.html);
  }
}

/** Must precede all styles/resources; the executor must also enforce OS-level egress denial. */
export function applyControlledBrowserResourcePolicy(html: string) {
  const head = "<head>";
  if (!html.startsWith("<!doctype html>\n<html ") || html.indexOf(head) < 0)
    throw new Error("CONTROLLED_RENDER_COMPILED_DOCUMENT_SHAPE_INVALID");
  return html.replace(head, `${head}\n  <meta http-equiv="Content-Security-Policy" content="${CONTROLLED_BROWSER_RESOURCE_POLICY}" />`);
}
