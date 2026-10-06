import {
  HTML_EDITING_LIMITS, htmlEditableManifestSchema, htmlEditingBindingSchema,
  htmlEditingCommandSchema, type HtmlEditableManifest, type HtmlEditingBinding, type HtmlEditingCommand,
} from "./html-editing.contract";

export type HtmlEditingRejectionCode = "INVALID_JSON" | "PAYLOAD_LIMIT" | "INVALID_MANIFEST"
  | "INVALID_COMMAND" | "STALE_BINDING" | "UNKNOWN_ELEMENT" | "PROPERTY_NOT_DECLARED"
  | "DUPLICATE_OVERRIDE" | "VALUE_NOT_DECLARED" | "ASSET_NOT_AUTHORIZED" | "MANIFEST_DIGEST_MISMATCH"
  | "INVALID_OVERRIDE_STATE" | "SOURCE_DIGEST_MISMATCH" | "INVALID_SOURCE" | "ASSET_SOURCE_MISSING";

export class HtmlEditingValidationError extends Error {
  constructor(readonly code: HtmlEditingRejectionCode) {
    super(`HTML_EDITING_${code}`);
    this.name = "HtmlEditingValidationError";
  }
}

const OPERATION_PROPERTY = { SET_TEXT: "TEXT", SET_IMAGE: "IMAGE", SET_THEME: "THEME" } as const;

export function decodeHtmlEditingBoundedJson(encoded: string, maxBytes: number): unknown {
  if (typeof encoded !== "string") throw new HtmlEditingValidationError("INVALID_JSON");
  if (encoded.length > maxBytes || new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  }
  try { return JSON.parse(encoded); }
  catch { throw new HtmlEditingValidationError("INVALID_JSON"); }
}

export function htmlEditingBindingsMatch(actual: HtmlEditingBinding, expected: HtmlEditingBinding): boolean {
  return (Object.keys(expected) as (keyof HtmlEditingBinding)[]).every((key) => actual[key] === expected[key]);
}

/** Schema validation is not source/hash attestation or tenant authorization. The
 * caller must supply an independently verified binding and current asset grants. */
export function parseHtmlEditableManifest(encoded: string, verifiedBinding: HtmlEditingBinding): HtmlEditableManifest {
  const expected = htmlEditingBindingSchema.safeParse(verifiedBinding);
  const parsed = htmlEditableManifestSchema.safeParse(decodeHtmlEditingBoundedJson(encoded, HTML_EDITING_LIMITS.manifestBytes));
  if (!expected.success || !parsed.success) throw new HtmlEditingValidationError("INVALID_MANIFEST");
  if (!htmlEditingBindingsMatch(parsed.data.binding, expected.data)) throw new HtmlEditingValidationError("STALE_BINDING");
  return parsed.data;
}

/** Pure preflight only: does not mutate source, apply overrides, or authorize an
 * operation. grantedAssetIds must come from server-side ownership checks. */
export function validateHtmlEditingCommand(params: {
  encodedCommand: string; manifest: HtmlEditableManifest;
  verifiedBinding: HtmlEditingBinding; grantedAssetIds: readonly string[];
}): HtmlEditingCommand {
  const manifest = htmlEditableManifestSchema.safeParse(params.manifest);
  const expected = htmlEditingBindingSchema.safeParse(params.verifiedBinding);
  if (!manifest.success || !expected.success) throw new HtmlEditingValidationError("INVALID_MANIFEST");
  const parsed = htmlEditingCommandSchema.safeParse(decodeHtmlEditingBoundedJson(params.encodedCommand, HTML_EDITING_LIMITS.commandBytes));
  if (!parsed.success) throw new HtmlEditingValidationError("INVALID_COMMAND");
  if (!htmlEditingBindingsMatch(manifest.data.binding, expected.data) || !htmlEditingBindingsMatch(parsed.data.binding, expected.data)) {
    throw new HtmlEditingValidationError("STALE_BINDING");
  }
  const elements = new Map(manifest.data.elements.map((element) => [element.elementId, element]));
  const grants = new Set(params.grantedAssetIds);
  const touched = new Set<string>();
  for (const override of parsed.data.overrides) {
    const element = elements.get(override.elementId);
    if (!element) throw new HtmlEditingValidationError("UNKNOWN_ELEMENT");
    const property = override.operation === "RESET" ? override.property : OPERATION_PROPERTY[override.operation];
    if (element.kind !== property) throw new HtmlEditingValidationError("PROPERTY_NOT_DECLARED");
    const key = `${override.elementId}:${property}`;
    if (touched.has(key)) throw new HtmlEditingValidationError("DUPLICATE_OVERRIDE");
    touched.add(key);
    if (override.operation === "SET_TEXT" && element.kind === "TEXT") {
      if (Array.from(override.value).length > element.maxCharacters || (!element.multiline && /[\r\n\u2028\u2029]/u.test(override.value))) {
        throw new HtmlEditingValidationError("VALUE_NOT_DECLARED");
      }
    } else if (override.operation === "SET_IMAGE" && element.kind === "IMAGE") {
      if (!element.allowedAssetIds.includes(override.assetId) || !element.allowedFits.includes(override.fit)) {
        throw new HtmlEditingValidationError("VALUE_NOT_DECLARED");
      }
      if (!grants.has(override.assetId)) throw new HtmlEditingValidationError("ASSET_NOT_AUTHORIZED");
    } else if (override.operation === "SET_THEME" && element.kind === "THEME") {
      if (element.tokenId !== override.tokenId || !element.allowedChoiceIds.includes(override.choiceId)) {
        throw new HtmlEditingValidationError("VALUE_NOT_DECLARED");
      }
    }
  }
  return parsed.data;
}
