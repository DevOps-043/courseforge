import { htmlEditingInspectorViewSchema } from "./html-editing/html-editing-inspector.contract";
import { HTML_EDITING_LIMITS, htmlEditingCommandSchema, type HtmlEditingCommand } from "./html-editing/html-editing.contract";
import { HtmlEditingValidationError, validateHtmlEditingCommand } from "./html-editing/html-editing-validation";
import { htmlEditingMutationRequestSchema, type HtmlEditingMutationRequest } from "./composition-html-editing-mutation.contract";

/** UI preflight only. Server still derives binding and validates current grants;
 * this function never supplies HTML, authority or permissions in the POST body. */
export type HtmlEditingFieldOverride = HtmlEditingCommand["overrides"][number];

function validateDraft(viewInput: unknown, overridesInput: unknown) {
  const view = htmlEditingInspectorViewSchema.parse(viewInput);
  const overrides = htmlEditingCommandSchema.shape.overrides.parse(overridesInput);
  validateHtmlEditingCommand({ encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1",
    binding: view.manifest.binding, overrides }), manifest: view.manifest,
    verifiedBinding: view.manifest.binding, grantedAssetIds: view.grantedAssetIds });
  for (const override of overrides) {
    if (override.operation === "RESET" && (override.property === "IMAGE"
      || (override.property === "ALL" && view.manifest.elements.find(element => element.elementId === override.elementId)?.kind === "IMAGE"))) {
      const original = view.defaults.find(element => element.elementId === override.elementId);
      if (original?.kind === "IMAGE" && original.assetId && !view.grantedAssetIds.includes(original.assetId)) {
        throw new HtmlEditingValidationError("ASSET_NOT_AUTHORIZED");
      }
    }
  }
  return { view, overrides };
}

/** Local staging may temporarily leave other fields unrepaired; it publishes
 * nothing. Replacement of an already staged field never creates duplicates. */
export function stageHtmlEditingFieldOverride(viewInput: unknown, draftInput: unknown, overrideInput: unknown): HtmlEditingFieldOverride[] {
  const view = htmlEditingInspectorViewSchema.parse(viewInput);
  const prior = htmlEditingCommandSchema.shape.overrides.element.array().max(HTML_EDITING_LIMITS.commandOverrides).parse(draftInput);
  if (prior.length) validateDraft(view, prior);
  const override = htmlEditingCommandSchema.shape.overrides.element.parse(overrideInput);
  const overrides = [...prior.filter(value => value.elementId !== override.elementId), override];
  const valid = validateDraft(view, overrides).overrides;
  const byElement = new Map(valid.map(value => [value.elementId, value]));
  return view.manifest.elements.flatMap(element => {
    const value = byElement.get(element.elementId); return value ? [value] : [];
  });
}

/** Prepare the original values of every declared field on one physical node.
 * No dispatch and no target selector in the resulting command: one ordinary
 * bounded batch of field RESETs. Any invalid default/grant/budget rejects the
 * whole staging operation, leaving the caller's previous draft untouched. */
export function stageHtmlEditingTargetReset(viewInput: unknown, draftInput: unknown, targetElementId: string): HtmlEditingFieldOverride[] {
  const view = htmlEditingInspectorViewSchema.parse(viewInput);
  const fields = view.manifest.elements.filter(element => (element.targetElementId ?? element.elementId) === targetElementId);
  if (!fields.length) throw new HtmlEditingValidationError("UNKNOWN_ELEMENT");
  const prior = htmlEditingCommandSchema.shape.overrides.element.array().max(HTML_EDITING_LIMITS.commandOverrides).parse(draftInput);
  if (prior.length) validateDraft(view, prior);
  const fieldIds = new Set(fields.map(field => field.elementId));
  const resets: HtmlEditingFieldOverride[] = fields.map(field => ({ operation: "RESET", elementId: field.elementId, property: field.kind }));
  const valid = validateDraft(view, [...prior.filter(override => !fieldIds.has(override.elementId)), ...resets]).overrides;
  const byElement = new Map(valid.map(override => [override.elementId, override]));
  return view.manifest.elements.flatMap(element => {
    const override = byElement.get(element.elementId);
    return override ? [override] : [];
  });
}

/** Final preflight checks declared image outcomes, not CSS dependency closure,
 * bytes/decoding/render or durable permission. The server checks the full result. */
export function prepareHtmlEditingBatchCommand(viewInput: unknown, overridesInput: unknown): HtmlEditingMutationRequest {
  const { view, overrides } = validateDraft(viewInput, overridesInput);
  const staged = new Map(overrides.map(value => [value.elementId, value]));
  for (const element of view.manifest.elements) {
    if (element.kind !== "IMAGE") continue;
    const update = staged.get(element.elementId);
    const stored = view.state.overrides.find(value => value.elementId === element.elementId);
    const original = view.defaults.find(value => value.elementId === element.elementId);
    const assetId = update?.operation === "SET_IMAGE" ? update.assetId : update?.operation === "RESET"
      ? original?.kind === "IMAGE" ? original.assetId : null : stored?.operation === "SET_IMAGE" ? stored.assetId
        : original?.kind === "IMAGE" ? original.assetId : null;
    if (assetId && !view.grantedAssetIds.includes(assetId)) throw new HtmlEditingValidationError("ASSET_NOT_AUTHORIZED");
  }
  return htmlEditingMutationRequestSchema.parse({ action: "COMMAND", expected: { version: view.revisionVersion, sha256: view.revisionSha256 },
    expectedCompositionDocumentHash: view.compositionDocumentHash, overrides });
}

export function prepareHtmlEditingFieldCommand(viewInput: unknown, overrideInput: unknown): HtmlEditingMutationRequest {
  return prepareHtmlEditingBatchCommand(viewInput, [overrideInput]);
}
