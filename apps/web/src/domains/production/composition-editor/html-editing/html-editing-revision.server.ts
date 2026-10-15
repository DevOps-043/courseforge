import { createHash } from "node:crypto";
import type { HtmlEditingBinding } from "./html-editing.contract";
import { canonicalHtmlEditingJson } from "./html-editing-canonical-json.server";
import { compileHtmlEditingFragment } from "./html-editing-compiler.server";
import { reduceHtmlEditingOverrides } from "./html-editing-override-reducer.server";
import { decodeHtmlEditingBoundedJson } from "./html-editing-validation";
import {
  HTML_EDITING_REVISION_POLICY, HtmlEditingRevisionError, htmlEditingRevisionSchema,
  type HtmlEditingExpectedRevision, type HtmlEditingRevision,
} from "./html-editing-revision.contract";

const revisionDigestPrefix = "courseforge-html-editable-revision-digest-v1\n";
export type HtmlEditingRevisionAuthority = {
  authoritativeBinding: HtmlEditingBinding; grantedAssetIds: readonly string[]; imageSources: ReadonlyMap<string, string>;
};
export type VerifiedHtmlEditingRevision = {
  revision: HtmlEditingRevision; sha256: string; compiled: ReturnType<typeof compileHtmlEditingFragment>;
};

function parseRevision(encoded: string): HtmlEditingRevision {
  const parsed = htmlEditingRevisionSchema.safeParse(decodeHtmlEditingBoundedJson(encoded, HTML_EDITING_REVISION_POLICY.maximumBytes));
  if (!parsed.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
  return parsed.data;
}
function revisionSha256(revision: HtmlEditingRevision): string {
  return createHash("sha256").update(revisionDigestPrefix + canonicalHtmlEditingJson(revision), "utf8").digest("hex");
}
function compileRevision(revision: HtmlEditingRevision, authority: HtmlEditingRevisionAuthority): VerifiedHtmlEditingRevision {
  const compiled = compileHtmlEditingFragment({ ...authority, sourceHtml: revision.sourceHtml,
    encodedManifest: JSON.stringify(revision.manifest), encodedState: JSON.stringify(revision.state) });
  return { revision, sha256: revisionSha256(revision), compiled };
}
function assertExpected(revision: HtmlEditingRevision, expected: HtmlEditingExpectedRevision): void {
  if (!Number.isSafeInteger(expected.version) || !/^[a-f0-9]{64}$/.test(expected.sha256)
    || expected.version !== revision.version || expected.sha256 !== revisionSha256(revision)) {
    throw new HtmlEditingRevisionError("REVISION_CONFLICT");
  }
}
function nextVersion(version: number): number {
  if (version >= HTML_EDITING_REVISION_POLICY.maximumVersion) throw new HtmlEditingRevisionError("VERSION_EXHAUSTED");
  return version + 1;
}

/** Read/render must revalidate current grants; a content hash alone grants nothing. */
export function verifyHtmlEditingRevision(params: HtmlEditingRevisionAuthority & { encodedRevision: string }): VerifiedHtmlEditingRevision {
  return compileRevision(parseRevision(params.encodedRevision), params);
}

export function prepareHtmlEditingRevisionCommand(params: HtmlEditingRevisionAuthority & {
  encodedRevision: string; expected: HtmlEditingExpectedRevision; encodedCommand: string;
}): { before: HtmlEditingRevision; beforeSha256: string; next: VerifiedHtmlEditingRevision; changed: boolean } {
  const before = parseRevision(params.encodedRevision);
  assertExpected(before, params.expected);
  const reduction = reduceHtmlEditingOverrides({ ...params,
    encodedManifest: JSON.stringify(before.manifest), encodedState: JSON.stringify(before.state) });
  // A prior revoked image may be removable. Verify immutable source and manifest
  // through the resulting compilation, not by demanding the old output render.
  const changed = reduction.changedElementIds.length > 0;
  // Canonical element ordering is not itself an edit. A semantic no-op must
  // preserve the current digest, even if a stored snapshot used another order.
  const revision = { ...before, version: changed ? nextVersion(before.version) : before.version,
    state: changed ? reduction.nextState : before.state };
  const next = compileRevision(parseRevision(JSON.stringify(revision)), params);
  return { before, beforeSha256: revisionSha256(before), next, changed };
}

/** Undo/redo appends old content at a NEW version; it never rewinds a revision
 * counter or bypasses current permissions. This prepares, but does not persist. */
export function prepareHtmlEditingRevisionRestore(params: HtmlEditingRevisionAuthority & {
  encodedRevision: string; expected: HtmlEditingExpectedRevision; encodedRestoreRevision: string;
}): { before: HtmlEditingRevision; beforeSha256: string; next: VerifiedHtmlEditingRevision; changed: boolean } {
  const before = parseRevision(params.encodedRevision);
  assertExpected(before, params.expected);
  const restore = parseRevision(params.encodedRestoreRevision);
  // History may restore only overrides of the same immutable source/declaration.
  if (before.sourceHtml !== restore.sourceHtml || canonicalHtmlEditingJson(before.manifest) !== canonicalHtmlEditingJson(restore.manifest)) {
    throw new HtmlEditingRevisionError("RESTORE_SOURCE_MISMATCH");
  }
  const changed = canonicalHtmlEditingJson(before.state) !== canonicalHtmlEditingJson(restore.state);
  const revision = { ...before, version: changed ? nextVersion(before.version) : before.version, state: restore.state };
  const next = compileRevision(parseRevision(JSON.stringify(revision)), params);
  return { before, beforeSha256: revisionSha256(before), next, changed };
}
