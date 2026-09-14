import assert from "node:assert/strict";
import test from "node:test";
import { ExternalImportCapacityError } from "../external-import-concurrency";
import { mapExternalImportError } from "../external-import-error";
import { OutboundCircuitOpenError } from "../outbound-http";

test("external import errors expose only allowlisted operational messages", () => {
  const mapped = mapExternalImportError(
    new Error("Error subiendo el archivo a Supabase Storage: private database detail"),
    "Google Drive",
  );
  assert.deepEqual(mapped, {
    code: "PROVIDER_ERROR",
    message: "No se pudo completar la importación desde Google Drive.",
    retryable: true,
    status: 502,
  });
});

test("external import errors preserve safe recovery semantics", () => {
  assert.equal(
    mapExternalImportError(new Error("El archivo supera el límite de importación de 150 MB."), "OneDrive").status,
    413,
  );
  assert.equal(
    mapExternalImportError(new Error("No hay cuenta de Google vinculada para este usuario."), "Google Drive").status,
    409,
  );
  assert.equal(
    mapExternalImportError(new DOMException("deadline", "TimeoutError"), "Artlist").status,
    504,
  );
  assert.deepEqual(
    mapExternalImportError(new ExternalImportCapacityError("queue_full"), "Artlist"),
    {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "La capacidad de importación está ocupada. Intenta nuevamente en unos segundos.",
      retryAfterSeconds: 5,
      retryable: true,
      status: 503,
    },
  );
  assert.deepEqual(
    mapExternalImportError(new OutboundCircuitOpenError(17), "Google Drive"),
    {
      code: "DEPENDENCY_UNAVAILABLE",
      message: "Google Drive está temporalmente no disponible. Intenta nuevamente en unos segundos.",
      retryAfterSeconds: 17,
      retryable: true,
      status: 503,
    },
  );
});
