/** Publication metadata is a routing hint; the server independently reauthorizes all pins. */
export function captureHtmlEditingPreviewSource(input: {documentHash: string;
  document: {htmlEditing?: {items: readonly unknown[]}}}) {
  return {documentHash: input.documentHash, hasHtmlEditing: Boolean(input.document.htmlEditing?.items.length)};
}

export function resolveHtmlEditingPreviewChannel(documentHash: string | null,
  source: ReturnType<typeof captureHtmlEditingPreviewSource> | null): "HTML_EDITING" | "NATIVE" | null {
  if (!documentHash || source?.documentHash !== documentHash) return null;
  return source.hasHtmlEditing ? "HTML_EDITING" : "NATIVE";
}

export function resolveHtmlEditingPublishedPreviewRevision(input: {
  documentHash: string | null;
  activeRevisionId: string | null;
  snapshots: readonly { id: string; documentHash: string }[] | null;
}): string | undefined {
  if (!input.documentHash || !input.activeRevisionId || !input.snapshots) return undefined;
  const active = input.snapshots.find(snapshot => snapshot.id === input.activeRevisionId);
  return active?.documentHash === input.documentHash ? active.id : undefined;
}
