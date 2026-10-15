import { z } from "zod";
import { HTML_EDITING_LIMITS, htmlEditableManifestSchema, htmlEditingOverrideStateSchema } from "./html-editing.contract";

export const HTML_EDITING_REVISION_POLICY = Object.freeze({ maximumBytes: 1024 * 1024, maximumVersion: 1_000_000 });
export const htmlEditingRevisionLocatorSchema = z.object({ version: z.number().int().min(1).max(HTML_EDITING_REVISION_POLICY.maximumVersion),
  sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const htmlEditingRevisionSchema = z.object({
  format: z.literal("courseforge-html-editable-revision-v1"),
  version: z.number().int().min(1).max(HTML_EDITING_REVISION_POLICY.maximumVersion),
  // Manifest bindings identify the immutable template's issuance/base revision,
  // not the current mutable native document. The enclosing digest covers state.
  sourceHtml: z.string().min(1).max(HTML_EDITING_LIMITS.sourceBytes),
  manifest: htmlEditableManifestSchema,
  state: htmlEditingOverrideStateSchema,
}).strict();

export type HtmlEditingRevision = z.infer<typeof htmlEditingRevisionSchema>;
export type HtmlEditingExpectedRevision = { version: number; sha256: string };

export class HtmlEditingRevisionError extends Error {
  constructor(readonly code: "INVALID_REVISION" | "REVISION_CONFLICT" | "VERSION_EXHAUSTED" | "RESTORE_SOURCE_MISMATCH"
    | "READ_UNAVAILABLE" | "COMMIT_UNCONFIRMED") {
    super(`HTML_EDITING_${code}`);
    this.name = "HtmlEditingRevisionError";
  }
}
