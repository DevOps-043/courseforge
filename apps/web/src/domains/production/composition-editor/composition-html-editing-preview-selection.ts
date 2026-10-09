/** Publication metadata is a routing hint; the server independently reauthorizes all pins. */
export function resolveHtmlEditingPublishedPreviewRevision(input: {
  documentHash: string | null;
  activeRevisionId: string | null;
  snapshots: readonly { id: string; documentHash: string }[] | null;
}): string | undefined {
  if (!input.documentHash || !input.activeRevisionId || !input.snapshots) return undefined;
  const active = input.snapshots.find(snapshot => snapshot.id === input.activeRevisionId);
  return active?.documentHash === input.documentHash ? active.id : undefined;
}
