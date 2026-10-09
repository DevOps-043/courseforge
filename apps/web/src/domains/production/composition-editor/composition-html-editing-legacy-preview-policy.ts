const LEGACY_PREVIEW_MAX_CHARACTERS = 200_000;

type LegacyRevisionPreview =
  | { kind: "available"; html: string }
  | { kind: "unavailable" }
  | { kind: "html-editing-required" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Stored preview_html is not authority for editable snapshots. Even a malformed
 * descriptor must not downgrade to the legacy page/CSP. This does not authorize
 * or reconstruct a frozen snapshot; that requires the dedicated delivery flow. */
export function readLegacyRevisionPreview(manifest: unknown): LegacyRevisionPreview {
  if (!isRecord(manifest)) return { kind: "unavailable" };
  const reference = manifest.conformance_reference;
  if (Object.hasOwn(manifest, "html_editing_snapshot")
    || (isRecord(reference) && Object.hasOwn(reference, "htmlEditingSnapshot"))) {
    return { kind: "html-editing-required" };
  }
  const html = manifest.preview_html;
  if (typeof html !== "string" || html.length === 0 || html.length > LEGACY_PREVIEW_MAX_CHARACTERS) {
    return { kind: "unavailable" };
  }
  return { kind: "available", html };
}
