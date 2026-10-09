import { isDeepStrictEqual } from "node:util";
import { prepareLegacyHtmlEditingPilot } from "./html-editing-legacy-instrumentation.server";
import { decodeHtmlEditingBoundedJson, HtmlEditingValidationError } from "./html-editing-validation";

export const HTML_LEGACY_PILOT_REVIEW_POLICY = Object.freeze({ maximumBytes: 2 * 1024 * 1024 });

/** Reproduce the candidate against independently authorized original/context,
 * current compiler and grants. A matching digest is not reviewer approval or
 * install authority. Never accept anchor, source or grants from the package as
 * the authoritative inputs. Returns only a fresh review-required candidate. */
export function verifyLegacyHtmlEditingPilotPackage(params: {
  encodedPilot: string; expectedProvenanceSha256: string;
  authoritativeInputs: Parameters<typeof prepareLegacyHtmlEditingPilot>[0];
}) {
  const submitted = decodeHtmlEditingBoundedJson(params.encodedPilot, HTML_LEGACY_PILOT_REVIEW_POLICY.maximumBytes);
  if (!/^[a-f0-9]{64}$/.test(params.expectedProvenanceSha256)) throw new HtmlEditingValidationError("INVALID_SOURCE");
  const expected = prepareLegacyHtmlEditingPilot(params.authoritativeInputs);
  const serializedExpected = JSON.stringify(expected);
  if (Buffer.byteLength(serializedExpected, "utf8") > HTML_LEGACY_PILOT_REVIEW_POLICY.maximumBytes)
    throw new HtmlEditingValidationError("PAYLOAD_LIMIT");
  if (expected.provenanceSha256 !== params.expectedProvenanceSha256
    || !isDeepStrictEqual(submitted, expected))
    throw new HtmlEditingValidationError("INVALID_SOURCE");
  return expected;
}
