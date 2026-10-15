import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { compileCompositionHtmlEditingFragments, type CompositionHtmlEditingCompilation } from "./composition-html-editing-compilation.server";
import { parseHtmlEditingStaticSource } from "./html-editing/html-editing-static-source.server";
import { isolateHtmlEditingStylesheet } from "./html-editing/html-editing-isolation.server";
import { createLocalHtmlResourceValidator } from "./html-editing/html-local-resource-policy.server";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";

/** Source preflight before asynchronous resource acquisition. No resource is
 * authorized merely because an alias occurs in CSS. Current supported global
 * styles are resource-free; fragment image references use their existing ledger. */
export function assertCompositionHtmlEditingDeckStyleSource(document: CompositionEditorDocument) {
  const styles = document.deckStyles;
  if (styles === null) return;
  if (styles.fontUrls.length) throw new Error("HTML_EDITING_DECK_STYLES_UNSUPPORTED");
  const validator = createLocalHtmlResourceValidator({localFiles: new Set(), remoteToLocal: new Map()});
  try {validator.assertCss(styles.css);} catch {throw new Error("HTML_EDITING_DECK_STYLES_RESOURCES_UNSUPPORTED");}
  for (const clip of document.clips) if (clip.source.type === "DECK_SLIDE") parseHtmlEditingStaticSource(clip.source.html, styles.css);
}

/** Contextual CSS derivation, not renderer execution/activation. Source/native
 * bytes remain immutable. A document with unbound neighbouring HTML requires an
 * explicit adapter; don't leave its global stylesheet unrestricted.
 * Physical cascade/layout coverage remains its independent completion gate. */
export function prepareCompositionHtmlEditingDeckStyles(input: {
  document: Parameters<typeof compileCompositionHtmlEditingFragments>[0]["document"];
  documentHash: string; context: CompositionHtmlEditingCompilation; assetUrls: ReadonlyMap<string, string>;
}) {
  const document = compositionEditorDocumentSchema.parse(input.document), styles = document.deckStyles;
  assertCompositionHtmlEditingDeckStyleSource(document);
  // Prove exact native/revision bindings even when the stylesheet is absent.
  const fragments = compileCompositionHtmlEditingFragments({...input, document});
  if (styles === null) return "";
  if (!fragments.size || styles.fontUrls.length || document.clips.some(clip => clip.source.type === "DECK_SLIDE" && !fragments.has(clip.id)))
    throw new Error("HTML_EDITING_DECK_STYLES_UNSUPPORTED");
  const localFiles = new Set([...input.assetUrls].map(([id, path]) => {
    if (path !== `conformance-media/${id}`) throw new Error("HTML_EDITING_DECK_STYLES_UNSUPPORTED");
    return path;
  }));
  const validator = createLocalHtmlResourceValidator({localFiles, remoteToLocal: new Map()});
  validator.assertCss(styles.css);
  // Resource-using global CSS needs a distinct used-image ledger and current
  // grant refresh, not inference from available aliases. Explicitly unsupported
  // here rather than pretending this helper updates snapshot/resource manifests.
  if (validator.referencedLocalFiles.size) throw new Error("HTML_EDITING_DECK_STYLES_RESOURCES_UNSUPPORTED");
  const derived: string[] = [];
  let bytes = 0;
  for (const entry of [...input.context.revisions].sort((first, second) => first.authoritativeBinding.clipId.localeCompare(second.authoritativeBinding.clipId))) {
    const clip = document.clips.find(candidate => candidate.id === entry.authoritativeBinding.clipId);
    if (!clip || clip.source.type !== "DECK_SLIDE") throw new Error("HTML_EDITING_DECK_STYLES_UNSUPPORTED");
    parseHtmlEditingStaticSource(clip.source.html, styles.css);
    const css = isolateHtmlEditingStylesheet(styles.css, entry.authoritativeBinding);
    bytes += Buffer.byteLength(css);
    if (bytes > HTML_EDITING_LIMITS.cssBytes * HTML_EDITING_LIMITS.elements) throw new Error("HTML_EDITING_DECK_STYLES_PAYLOAD_LIMIT");
    derived.push(css);
  }
  return derived.join("\n");
}
