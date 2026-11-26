import { createHash } from "node:crypto";
import type { CompositionEditorDocument } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document-hash";

/** Reconoce solo la huella histórica del generador narrativo. No legitima un
 * hash arbitrario ni modifica revisiones: el llamador debe crear otra vía CAS. */
export function matchesLegacyNarrativeUndefinedHash(document: CompositionEditorDocument, storedHash: string) {
  if (!document.narrativeScenes?.length || document.htmlEditing?.items.length
    || hashCompositionDocument(document) === storedHash) return false;
  const reconstructed = { ...document, narrativeScenes: document.narrativeScenes.map(scene => ({
    ...scene, visualPlan: scene.visualPlan, wordTimestamps: scene.wordTimestamps,
  })) };
  return createHash("sha256").update(legacyCanonicalJson(reconstructed)).digest("hex") === storedHash;
}

// Exclusivamente para reconocer la firma anterior; nunca se usa para escribir.
function legacyCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyCanonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${legacyCanonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
