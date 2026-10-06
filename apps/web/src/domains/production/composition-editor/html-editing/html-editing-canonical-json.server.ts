export type HtmlEditingCanonicalValue = string | number | boolean | HtmlEditingCanonicalValue[]
  | { [key: string]: HtmlEditingCanonicalValue };

/** Call only after bounded schema parsing. Arrays and Unicode are preserved;
 * this project encoding does not claim RFC 8785/JCS conformance. */
export function canonicalHtmlEditingJson(value: HtmlEditingCanonicalValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalHtmlEditingJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalHtmlEditingJson(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
