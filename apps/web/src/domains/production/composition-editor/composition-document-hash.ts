import { createHash } from "node:crypto";
import type { CompositionEditorDocument } from "./composition-document.types";

export function hashCompositionDocument(document: CompositionEditorDocument) {
  return createHash("sha256").update(stableStringify(document)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
