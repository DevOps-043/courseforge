import {
  HTML_EDITING_LIMITS, htmlEditingOverrideStateSchema,
  type HtmlEditableManifest, type HtmlEditingBinding, type HtmlEditingOverrideState, type HtmlEditingSetOverride,
} from "./html-editing.contract";
import {
  decodeHtmlEditingBoundedJson, htmlEditingBindingsMatch, HtmlEditingValidationError,
  validateHtmlEditingCommand,
} from "./html-editing-validation";
import { verifyHtmlEditableManifestContent } from "./html-editing-manifest-digest.server";
import { readHtmlEditingChartDataset } from "./html-editing-chart.contract";

function validateSnapshotOverrides(
  state: HtmlEditingOverrideState, manifest: HtmlEditableManifest, grantedAssetIds: readonly string[],
): void {
  // Stored snapshots can exceed one command's count/byte limits. A single bounded
  // override fits the command budget; reuse the policy without copying it.
  for (const override of state.overrides) {
    validateHtmlEditingCommand({
      encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: state.binding,
        overrides: [override] }),
      manifest, verifiedBinding: manifest.binding, grantedAssetIds,
    });
  }
}

export type HtmlEditingOverrideReduction = {
  previousState: HtmlEditingOverrideState;
  nextState: HtmlEditingOverrideState;
  changedElementIds: string[];
};

/** Pure experimental snapshot reduction, not a document transaction/gateway.
 * Returning a result publishes nothing; all validation must pass first. */
export function reduceHtmlEditingOverrides(params: {
  encodedState: string; encodedManifest: string; encodedCommand: string;
  authoritativeBinding: HtmlEditingBinding; grantedAssetIds: readonly string[];
}): HtmlEditingOverrideReduction {
  const manifest = verifyHtmlEditableManifestContent(params.encodedManifest, params.authoritativeBinding);
  const parsed = htmlEditingOverrideStateSchema.safeParse(decodeHtmlEditingBoundedJson(params.encodedState, HTML_EDITING_LIMITS.stateBytes));
  if (!parsed.success) throw new HtmlEditingValidationError("INVALID_OVERRIDE_STATE");
  const previousState = parsed.data;
  if (!htmlEditingBindingsMatch(previousState.binding, manifest.binding)) {
    throw new HtmlEditingValidationError("STALE_BINDING");
  }
  // Validate prior values against template policy, but do not require expired
  // grants here: an otherwise valid old image must remain removable via RESET.
  // Current grants are enforced on the command and entire resulting snapshot.
  const declaredAssets = manifest.elements.flatMap((element) => element.kind === "IMAGE" ? element.allowedAssetIds : []);
  validateSnapshotOverrides(previousState, manifest, declaredAssets);
  const command = validateHtmlEditingCommand({
    encodedCommand: params.encodedCommand, manifest,
    verifiedBinding: manifest.binding, grantedAssetIds: params.grantedAssetIds,
  });
  const priorByElement = new Map(previousState.overrides.map((override) => [override.elementId, override]));
  const nextByElement = new Map<string, HtmlEditingSetOverride>(priorByElement);
  for (const override of command.overrides) {
    if (override.operation === "RESET") nextByElement.delete(override.elementId);
    else if (override.operation === "SET_SLOT_ORDER" && manifest.elements.some(element => element.kind === "SLOTS"
      && element.elementId === override.elementId && JSON.stringify(element.itemIds) === JSON.stringify(override.itemIds))) {
      nextByElement.delete(override.elementId);
    }
    else if (override.operation === "SET_CHART_DATA" && manifest.elements.some(element => element.kind === "CHART"
      && element.elementId === override.elementId && JSON.stringify(readHtmlEditingChartDataset(element.chart)) === JSON.stringify(override.dataset))) {
      nextByElement.delete(override.elementId);
    }
    else if (override.operation === "SET_STYLE_RANGE" && manifest.elements.some(element => element.kind === "RANGE_TOKEN"
      && element.elementId === override.elementId && element.range.defaultValue === override.value)) {
      nextByElement.delete(override.elementId);
    }
    else nextByElement.set(override.elementId, override);
  }
  const nextState: HtmlEditingOverrideState = {
    format: previousState.format, binding: { ...manifest.binding },
    overrides: manifest.elements.flatMap((element) => {
      const override = nextByElement.get(element.elementId);
      return override ? [{ ...override }] : [];
    }),
  };
  if (new TextEncoder().encode(JSON.stringify(nextState)).byteLength > HTML_EDITING_LIMITS.stateBytes) {
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  }
  validateSnapshotOverrides(nextState, manifest, params.grantedAssetIds);
  const changedElementIds = manifest.elements.filter((element) =>
    JSON.stringify(priorByElement.get(element.elementId)) !== JSON.stringify(nextByElement.get(element.elementId)),
  ).map((element) => element.elementId);
  return { previousState, nextState, changedElementIds };
}
