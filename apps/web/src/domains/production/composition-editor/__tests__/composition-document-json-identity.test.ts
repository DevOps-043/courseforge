import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalCompositionDocumentJson } from "../composition-document-canonical-json";
import { hashCompositionDocument } from "../composition-document-hash";
import { matchesLegacyNarrativeUndefinedHash } from "../composition-document-legacy-hash.server";
import { createInitialCompositionDocument } from "../composition-document.factory";

const legacy = (value: unknown): string => Array.isArray(value) ? `[${value.map(legacy).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${legacy((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value: unknown) => createHash("sha256").update(legacy(value)).digest("hex");
function fixture() {
  const document = createInitialCompositionDocument({ animatedDeck: { width: 1920, height: 1080, fonts: [], css: "",
    slides: [{ index: 0, label: "Prueba", classes: "slide", html: "<h1>Contenido</h1>", animationCount: 0 }] }, assets: [],
    plan: { title: "Prueba", subtitle: "", accentColor: "#00aabb", durationSeconds: 5 } });
  // Fuente narrativa real con sus opcionales: el serializador anterior los
  // incluía en el digest, pero el transporte JSON los elimina.
  document.narrativeScenes = [{ id: "scene-1", order: 1, label: "Escena", scriptText: "Una escena", scriptHash: "a".repeat(64), needsReview: true,
    visualPlan: undefined, wordTimestamps: undefined }];
  return document;
}

test("la identidad permanece estable al persistir y transportar opcionales undefined", () => {
  const document = fixture();
  const wire = JSON.parse(JSON.stringify(document));
  assert.equal(hashCompositionDocument(document), hashCompositionDocument(wire));
  assert.deepEqual(JSON.parse(canonicalCompositionDocumentJson(document)), wire);
  assert.equal(canonicalCompositionDocumentJson({ items: [undefined, 1], optional: undefined }), '{"items":[null,1]}');
});

test("los pins de documentos JSON existentes conservan exactamente su identidad", () => {
  const wire = JSON.parse(JSON.stringify(fixture()));
  assert.equal(hashCompositionDocument(wire), digest(wire));
});

test("recupera solo la firma narrativa histórica exacta y rechaza contenido o pin alterado", () => {
  const source = fixture(); const stored = JSON.parse(JSON.stringify(source)); const oldHash = digest(source);
  assert.notEqual(oldHash, hashCompositionDocument(stored));
  assert.equal(matchesLegacyNarrativeUndefinedHash(stored, oldHash), true);
  assert.equal(matchesLegacyNarrativeUndefinedHash(stored, hashCompositionDocument(stored)), false);
  assert.equal(matchesLegacyNarrativeUndefinedHash(stored, "f".repeat(64)), false);
  const changed = structuredClone(stored); changed.narrativeScenes[0].scriptText = "Contenido distinto";
  assert.equal(matchesLegacyNarrativeUndefinedHash(changed, oldHash), false);
});
