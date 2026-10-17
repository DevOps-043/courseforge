import { z } from "zod";
import { htmlEditingChartSpecSchema, htmlEditingChartDatasetSchema } from "./html-editing-chart.contract";
import { htmlEditingStyleRangeSchema } from "./html-editing-style-range.contract";
import { htmlEditingTextLocaleSchema, htmlEditingTextLocaleDeclarationSchema } from "./html-editing-text-locale.contract";

export const HTML_EDITING_LIMITS = Object.freeze({
  elements: 200, commandOverrides: 50, commandBytes: 64 * 1024,
  manifestBytes: 256 * 1024, textCharacters: 4096, choices: 32,
  stateBytes: 256 * 1024, sourceBytes: 250 * 1024, compiledBytes: 512 * 1024,
  sourceElements: 1500, sourceNodes: 1500, sourceDepth: 40, cssBytes: 250 * 1024,
  cssNodes: 4096, cssDepth: 16, slotItems: 128,
});

const stableId = z.string().min(1).max(96).regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
// V1 deliberately excludes markup delimiters and control characters. Values must
// still be assigned via textContent by a future adapter, never HTML interpolation.
const plainText = z.string().max(HTML_EDITING_LIMITS.textCharacters)
  .refine((value) => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
// elementId remains the stable field/operation identity. Existing declarations
// target their own ID; explicitly enrolled multi-field templates name the DOM ID.
const targetFields = { targetElementId: stableId.optional() };

export const htmlEditingBindingSchema = z.object({
  organizationId: z.string().uuid(), documentId: z.string().uuid(),
  revisionId: z.string().uuid(), documentSha256: sha256,
  clipId: stableId, templateId: stableId, templateVersion: z.number().int().min(1).max(1_000_000),
  sourceSha256: sha256, manifestSha256: sha256,
}).strict();

const textElement = z.object({
  ...targetFields,
  kind: z.literal("TEXT"), elementId: stableId, label: plainText.min(1).max(120),
  maxCharacters: z.number().int().min(1).max(HTML_EDITING_LIMITS.textCharacters),
  multiline: z.boolean(),
  localePolicy: htmlEditingTextLocaleDeclarationSchema.optional(),
}).strict();
const imageElement = z.object({
  ...targetFields,
  kind: z.literal("IMAGE"), elementId: stableId, label: plainText.min(1).max(120),
  allowedAssetIds: z.array(z.string().uuid()).min(1).max(HTML_EDITING_LIMITS.choices).refine(unique),
  allowedFits: z.array(z.enum(["CONTAIN", "COVER"])).min(1).max(2).refine(unique),
}).strict();
const themeElement = z.object({
  ...targetFields,
  kind: z.literal("THEME"), elementId: stableId, label: plainText.min(1).max(120),
  tokenId: stableId, allowedChoiceIds: z.array(stableId).min(1).max(HTML_EDITING_LIMITS.choices).refine(unique),
}).strict();
const rangeTokenElement = z.object({ ...targetFields, kind: z.literal("RANGE_TOKEN"), elementId: stableId, label: plainText.min(1).max(120),
  tokenId: stableId, range: htmlEditingStyleRangeSchema }).strict();
export const htmlEditingAttributeNameSchema = z.enum(["title", "aria-label", "aria-description", "lang", "dir"]);
export const htmlEditingAttributeValueSchema = plainText;
const attributeElement = z.object({
  ...targetFields,
  kind: z.literal("ATTRIBUTE"), elementId: stableId, label: plainText.min(1).max(120),
  attributeName: htmlEditingAttributeNameSchema,
  maxCharacters: z.number().int().min(1).max(HTML_EDITING_LIMITS.textCharacters),
  allowedValues: z.array(plainText).min(1).max(HTML_EDITING_LIMITS.choices).refine(unique).optional(),
}).strict();
export function isHtmlEditingDeclaredAttributeValue(element: z.infer<typeof attributeElement>, value: string): boolean {
  return htmlEditingAttributeValueSchema.safeParse(value).success && (!element.allowedValues || element.allowedValues.includes(value))
    && Array.from(value).length <= element.maxCharacters && !/[\r\n\u2028\u2029]/u.test(value)
    && (element.attributeName !== "dir" || ["ltr", "rtl", "auto"].includes(value))
    && (element.attributeName !== "lang" || /^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(value));
}
export const htmlEditingVisibleDisplaySchema = z.enum(["BLOCK", "INLINE", "INLINE_BLOCK", "FLEX", "INLINE_FLEX", "GRID", "INLINE_GRID"]);
const visibilityElement = z.object({
  ...targetFields,
  kind: z.literal("VISIBILITY"), elementId: stableId, label: plainText.min(1).max(120),
  visibleDisplay: htmlEditingVisibleDisplaySchema,
}).strict();
export const htmlEditingSlotOrderSchema = z.array(stableId).min(1).max(HTML_EDITING_LIMITS.slotItems).refine(unique);
export const htmlEditingSlotsElementSchema = z.object({
  ...targetFields,
  kind: z.literal("SLOTS"), elementId: stableId, label: plainText.min(1).max(120),
  itemIds: htmlEditingSlotOrderSchema,
}).strict();
export function isHtmlEditingSlotPermutation(declared: readonly string[], order: readonly string[]): boolean {
  const allowed = new Set(declared);
  return order.length === declared.length && new Set(order).size === order.length && order.every(id => allowed.has(id));
}
const chartElement = z.object({ ...targetFields, kind: z.literal("CHART"), elementId: stableId, label: plainText.min(1).max(120),
  chart: htmlEditingChartSpecSchema,
  accent: z.string().regex(/^#[a-fA-F0-9]{6}$/), accent2: z.string().regex(/^#[a-fA-F0-9]{6}$/),
}).strict();

export const htmlEditableManifestSchema = z.object({
  format: z.literal("courseforge-html-editable-manifest-v1"),
  binding: htmlEditingBindingSchema,
  elements: z.array(z.discriminatedUnion("kind", [textElement, imageElement, themeElement, rangeTokenElement, attributeElement, visibilityElement, htmlEditingSlotsElementSchema, chartElement]))
    .min(1).max(HTML_EDITING_LIMITS.elements)
    .refine((elements) => unique(elements.map((element) => element.elementId)))
    .refine(elements => {
      const sinks = elements.flatMap(element => {
        const target = element.targetElementId ?? element.elementId;
        const properties = element.kind === "ATTRIBUTE" ? [`attr:${element.attributeName}`]
          : element.kind === "RANGE_TOKEN" ? [`style:${element.range.property}`]
          : element.kind === "TEXT" ? ["content", ...(element.localePolicy ? ["attr:lang", "attr:dir"] : [])]
          : element.kind === "CHART" ? ["content"] : [element.kind];
        return properties.map(property => `${target}:${property}`);
      });
      return unique(sinks);
    })
    .refine(elements => elements.every(element => element.kind !== "ATTRIBUTE"
      || !element.allowedValues || element.allowedValues.every(value => isHtmlEditingDeclaredAttributeValue(element, value))))
    .refine(elements => elements.every(element => element.kind !== "SLOTS" || !element.itemIds.includes(element.targetElementId ?? element.elementId))),
}).strict();

export const htmlEditingSetOverrideSchema = z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("SET_TEXT"), elementId: stableId, value: plainText, locale: htmlEditingTextLocaleSchema.optional() }).strict(),
    z.object({ operation: z.literal("SET_IMAGE"), elementId: stableId,
      assetId: z.string().uuid(), fit: z.enum(["CONTAIN", "COVER"]) }).strict(),
    z.object({ operation: z.literal("SET_THEME"), elementId: stableId,
      tokenId: stableId, choiceId: stableId }).strict(),
    z.object({ operation: z.literal("SET_STYLE_RANGE"), elementId: stableId, tokenId: stableId, value: z.number().finite() }).strict(),
    z.object({ operation: z.literal("SET_ATTRIBUTE"), elementId: stableId,
      attributeName: htmlEditingAttributeNameSchema, value: htmlEditingAttributeValueSchema }).strict(),
    z.object({ operation: z.literal("SET_VISIBILITY"), elementId: stableId, visible: z.boolean() }).strict(),
    z.object({ operation: z.literal("SET_SLOT_ORDER"), elementId: stableId, itemIds: htmlEditingSlotOrderSchema }).strict(),
    z.object({ operation: z.literal("SET_CHART_DATA"), elementId: stableId, dataset: htmlEditingChartDatasetSchema }).strict(),
]);

export const htmlEditingCommandSchema = z.object({
  format: z.literal("courseforge-html-editable-command-v1"),
  binding: htmlEditingBindingSchema,
  overrides: z.array(z.discriminatedUnion("operation", [
    ...htmlEditingSetOverrideSchema.options,
    z.object({ operation: z.literal("RESET"), elementId: stableId,
      property: z.enum(["TEXT", "IMAGE", "THEME", "RANGE_TOKEN", "ATTRIBUTE", "VISIBILITY", "SLOTS", "CHART", "ALL"]) }).strict(),
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
