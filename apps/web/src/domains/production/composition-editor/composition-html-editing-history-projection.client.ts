import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT } from "./html-editing/html-editing-reference.contract";

/** Only use a current document already adopted from the authorized rebase verifier.
 * Native undo must pin present HTML revisions, not silently undo editorial state.
 * Missing/replaced original HTML sources become a checkpoint barrier. */
export function projectCurrentHtmlReferencesIntoHistory(historyDocument: CompositionEditorDocument,
  currentDocument: CompositionEditorDocument): CompositionEditorDocument | null {
  try {
    const current = compositionEditorDocumentSchema.parse(currentDocument), historical = compositionEditorDocumentSchema.parse(historyDocument);
    if (!current.htmlEditing?.items.length) return null;
    const liveClipIds = new Set(current.htmlEditing.items.map(reference => reference.clipId));
    if (historical.htmlEditing?.items.some(reference => !liveClipIds.has(reference.clipId))) return null;
    for (const reference of current.htmlEditing.items) {
      const currentClip = current.clips.find(clip => clip.id === reference.clipId);
      const historicalClip = historical.clips.find(clip => clip.id === reference.clipId);
      if (!currentClip || !historicalClip || currentClip.source.type !== "DECK_SLIDE" || historicalClip.source.type !== "DECK_SLIDE"
        || currentClip.source.html !== historicalClip.source.html) return null;
    }
    return compositionEditorDocumentSchema.parse({ ...historical, format: HTML_EDITABLE_COMPOSITION_DOCUMENT_FORMAT, htmlEditing: current.htmlEditing });
  } catch { return null; }
}
