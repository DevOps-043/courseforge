import { htmlSnapshotLocatorScopeSchema } from "./composition-html-snapshot-locator.client";

/** UI identity only, not authentication. Deliberately independent of selected
 * clip, inspector tab, document hash and write flags. Changed owner/draft remounts
 * panels, aborting their requests; malformed current context never reuses old scope. */
export function resolveHtmlEditingRecoveryContext(input: unknown) {
  const parsed = htmlSnapshotLocatorScopeSchema.safeParse(input);
  if (!parsed.success) return null;
  const scope = parsed.data;
  return { scope, key: `${scope.actorId}:${scope.organizationId}:${scope.draftId}` };
}
