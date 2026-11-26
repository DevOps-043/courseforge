/** Representación compartida de los bytes JSON persistibles. Los documentos JSON
 * existentes conservan su hash; las propiedades undefined no viajan a JSONB. */
export function canonicalCompositionDocumentJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => item === undefined ? "null" : canonicalCompositionDocumentJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalCompositionDocumentJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
