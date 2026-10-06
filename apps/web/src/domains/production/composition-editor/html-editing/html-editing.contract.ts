import { z } from "zod";

export const HTML_EDITING_LIMITS = Object.freeze({
  elements: 200, commandOverrides: 50, commandBytes: 64 * 1024,
  manifestBytes: 256 * 1024, textCharacters: 4096, choices: 32,
  stateBytes: 256 * 1024, sourceBytes: 256 * 1024, compiledBytes: 512 * 1024, sourceElements: 2000,
});

const stableId = z.string().min(1).max(96).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
// V1 deliberately excludes markup delimiters and control characters. Values must
// still be assigned via textContent by a future adapter, never HTML interpolation.
const plainText = z.string().max(HTML_EDITING_LIMITS.textCharacters)
  .refine((value) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;

export const htmlEditingBindingSchema = z.object({
  organizationId: z.string().uuid(), documentId: z.string().uuid(),
  revisionId: z.string().uuid(), documentSha256: sha256,
  clipId: stableId, templateId: stableId, templateVersion: z.number().int().min(1).max(1_000_000),
  sourceSha256: sha256, manifestSha256: sha256,
}).strict();

const textElement = z.object({
  kind: z.literal("TEXT"), elementId: stableId, label: plainText.min(1).max(120),
  maxCharacters: z.number().int().min(1).max(HTML_EDITING_LIMITS.textCharacters),
  multiline: z.boolean(),
}).strict();
const imageElement = z.object({
  kind: z.literal("IMAGE"), elementId: stableId, label: plainText.min(1).max(120),
  allowedAssetIds: z.array(z.string().uuid()).min(1).max(HTML_EDITING_LIMITS.choices).refine(unique),
  allowedFits: z.array(z.enum(["CONTAIN", "COVER"])).min(1).max(2).refine(unique),
}).strict();
const themeElement = z.object({
  kind: z.literal("THEME"), elementId: stableId, label: plainText.min(1).max(120),
  tokenId: stableId, allowedChoiceIds: z.array(stableId).min(1).max(HTML_EDITING_LIMITS.choices).refine(unique),
}).strict();

export const htmlEditableManifestSchema = z.object({
  format: z.literal("courseforge-html-editable-manifest-v1"),
  binding: htmlEditingBindingSchema,
  elements: z.array(z.discriminatedUnion("kind", [textElement, imageElement, themeElement]))
    .min(1).max(HTML_EDITING_LIMITS.elements)
    .refine((elements) => unique(elements.map((element) => element.elementId))),
}).strict();

export const htmlEditingSetOverrideSchema = z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("SET_TEXT"), elementId: stableId, value: plainText }).strict(),
    z.object({ operation: z.literal("SET_IMAGE"), elementId: stableId,
      assetId: z.string().uuid(), fit: z.enum(["CONTAIN", "COVER"]) }).strict(),
    z.object({ operation: z.literal("SET_THEME"), elementId: stableId,
      tokenId: stableId, choiceId: stableId }).strict(),
]);

export const htmlEditingCommandSchema = z.object({
  format: z.literal("courseforge-html-editable-command-v1"),
  binding: htmlEditingBindingSchema,
  overrides: z.array(z.discriminatedUnion("operation", [
    ...htmlEditingSetOverrideSchema.options,
    z.object({ operation: z.literal("RESET"), elementId: stableId,
      property: z.enum(["TEXT", "IMAGE", "THEME"]) }).strict(),
  ])).min(1).max(HTML_EDITING_LIMITS.commandOverrides),
}).strict();

export const htmlEditingOverrideStateSchema = z.object({
  format: z.literal("courseforge-html-editable-override-state-v1"),
  binding: htmlEditingBindingSchema,
  overrides: z.array(htmlEditingSetOverrideSchema).max(HTML_EDITING_LIMITS.elements)
    .refine((overrides) => unique(overrides.map((override) => override.elementId))),
}).strict();

export type HtmlEditingBinding = z.infer<typeof htmlEditingBindingSchema>;
export type HtmlEditableManifest = z.infer<typeof htmlEditableManifestSchema>;
export type HtmlEditingCommand = z.infer<typeof htmlEditingCommandSchema>;
export type HtmlEditingSetOverride = z.infer<typeof htmlEditingSetOverrideSchema>;
export type HtmlEditingOverrideState = z.infer<typeof htmlEditingOverrideStateSchema>;
