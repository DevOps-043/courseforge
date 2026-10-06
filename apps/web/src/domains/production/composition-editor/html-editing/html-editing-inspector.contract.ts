import { z } from "zod";
import { HTML_EDITING_LIMITS, htmlEditingBindingSchema, htmlEditableManifestSchema, htmlEditingOverrideStateSchema } from "./html-editing.contract";
import { htmlEditingBindingsMatch, validateHtmlEditingCommand } from "./html-editing-validation";
import { HTML_EDITING_REVISION_POLICY } from "./html-editing-revision.contract";

export const HTML_EDITING_INSPECTOR_POLICY = Object.freeze({ responseBytes: 2 * 1024 * 1024 });
const elementId = htmlEditingBindingSchema.shape.clipId;
const defaultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("TEXT"), elementId, value: z.string().max(HTML_EDITING_LIMITS.sourceBytes) }).strict(),
  z.object({ kind: z.literal("IMAGE"), elementId, assetId: z.string().uuid().nullable(), fit: z.enum(["CONTAIN", "COVER"]).nullable() }).strict(),
  z.object({ kind: z.literal("THEME"), elementId, choiceId: elementId.nullable() }).strict(),
]);
/** Values are inert JSON, not HTML. Display text using React text nodes/textContent.
 * Binding/hash/options are concurrency hints, NEVER client-side authorization. */
export const htmlEditingInspectorViewSchema = z.object({
  format: z.literal("courseforge-html-editable-inspector-v1"),
  revisionVersion: z.number().int().min(1).max(HTML_EDITING_REVISION_POLICY.maximumVersion), revisionSha256: z.string().regex(/^[a-f0-9]{64}$/),
  compositionDocumentHash: z.string().regex(/^[a-f0-9]{64}$/),
  manifest: htmlEditableManifestSchema, state: htmlEditingOverrideStateSchema,
  defaults: z.array(defaultSchema).max(HTML_EDITING_LIMITS.elements),
  grantedAssetIds: z.array(z.string().uuid()).max(6400).refine(ids => new Set(ids).size === ids.length),
  usedResourcesGranted: z.boolean(),
}).strict().superRefine((view, context) => {
  const declarations = new Map(view.manifest.elements.map(element => [element.elementId, element]));
  const declaredAssets = new Set(view.manifest.elements.flatMap(element => element.kind === "IMAGE" ? element.allowedAssetIds : []));
  if (!htmlEditingBindingsMatch(view.state.binding, view.manifest.binding)
    || view.defaults.length !== declarations.size || new Set(view.defaults.map(element => element.elementId)).size !== declarations.size
    || view.grantedAssetIds.some(id => !declaredAssets.has(id))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inspector identity" });
  for (const value of view.defaults) {
    const declaration = declarations.get(value.elementId);
    if (!declaration || value.kind !== declaration.kind
      || (value.kind === "IMAGE" && declaration.kind === "IMAGE" && value.assetId !== null && !declaration.allowedAssetIds.includes(value.assetId))
      || (value.kind === "THEME" && declaration.kind === "THEME" && value.choiceId !== null && !declaration.allowedChoiceIds.includes(value.choiceId))) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inspector default" });
    }
  }
  for (const override of view.state.overrides) {
    try {
      validateHtmlEditingCommand({ manifest: view.manifest, verifiedBinding: view.manifest.binding, grantedAssetIds: [...declaredAssets],
        encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: view.state.binding, overrides: [override] }) });
    } catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid inspector override" }); }
  }
});
export type HtmlEditingInspectorView = z.infer<typeof htmlEditingInspectorViewSchema>;
