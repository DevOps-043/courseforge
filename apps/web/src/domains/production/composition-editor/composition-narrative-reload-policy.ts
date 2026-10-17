import type { CompositionEditorDocument } from "./composition-document.types";
import type { NarrativeEditorReload } from "./composition-narrative-editor-controller";

/** Receipt is historical: newer authorized revisions remain current, including later deletions. */
export function acceptsNarrativeExtractionReload(document: CompositionEditorDocument, currentHash: string,
  receipt: NarrativeEditorReload): boolean {
  if (!/^[a-f0-9]{64}$/.test(currentHash)) return false;
  if (currentHash !== receipt.documentHash) return true;
  const ids = new Set(document.clips.map(clip => clip.id));
  return receipt.newClipIds.length > 0 && receipt.newClipIds.includes(receipt.anchorClipId)
    && receipt.newClipIds.every(id => ids.has(id));
}
