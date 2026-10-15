/** Stable composition hashing representation, shared by host and browser.
 * Preserve this format: changing it changes existing immutable document pins. */
export function canonicalCompositionDocumentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalCompositionDocumentJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalCompositionDocumentJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
