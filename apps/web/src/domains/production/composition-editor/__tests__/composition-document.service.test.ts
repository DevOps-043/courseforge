import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { getCurrentCompositionDocument, normalizeCompositionPersistenceError } from "../composition-document.service";

test("uses the stored document hash as the concurrency token", async () => {
  const storedHash = "a".repeat(64);
  const document = createInitialCompositionDocument({
    animatedDeck: {
      css: ".slide { color: white; }",
      fonts: [],
      height: 1080,
      slides: [
        {
          animationCount: 0,
          classes: "slide",
          html: "<section>Slide</section>",
          index: 0,
          label: "Introducción",
        },
      ],
      width: 1920,
    },
    assets: [],
    plan: {
      accentColor: "#38BDF8",
      durationSeconds: 5,
      subtitle: "Prueba",
      title: "Video de prueba",
    },
  });
  const query = {
    eq: () => query,
    limit: () => query,
    maybeSingle: async () => ({ data: { document, document_hash: storedHash, version: 1 }, error: null }),
    order: () => query,
    select: () => query,
  };
  const supabase = { from: () => query };

  const current = await getCurrentCompositionDocument({
    draftId: "f7d8853b-49cb-4a46-acd9-2c21696686c3",
    organizationId: "550e8400-e29b-41d4-a716-446655440000",
    supabase: supabase as never,
  });

  assert.equal(current.documentHash, storedHash);
  assert.equal(current.version, 1);
});

test("classifies statement cancellation as a retryable save timeout", () => {
  const error = normalizeCompositionPersistenceError(
    { code: "57014", message: "canceling statement due to statement timeout" },
    "diagnostic-1",
  );

  assert.equal(error.code, "COMPOSITION_SAVE_TIMEOUT");
  assert.equal(error.status, 503);
  assert.equal(error.retryable, true);
  assert.equal(error.diagnosticId, "diagnostic-1");
});

test("classifies an upstream gateway timeout as temporary storage unavailability", () => {
  const error = normalizeCompositionPersistenceError(
    { message: "upstream request timeout" },
    "diagnostic-upstream",
  );

  assert.equal(error.code, "COMPOSITION_STORAGE_UNAVAILABLE");
  assert.equal(error.status, 503);
  assert.equal(error.retryable, true);
  assert.equal(error.diagnosticId, "diagnostic-upstream");
});

test("keeps an unknown persistence failure generic while preserving correlation", () => {
  const error = normalizeCompositionPersistenceError(
    { code: "XX000", message: "internal error" },
    "diagnostic-2",
  );

  assert.equal(error.code, "COMPOSITION_PERSISTENCE_FAILED");
  assert.equal(error.status, 500);
  assert.equal(error.retryable, true);
  assert.equal(error.diagnosticId, "diagnostic-2");
});
