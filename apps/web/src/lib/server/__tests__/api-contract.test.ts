import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  API_ERROR_CODE,
  createApiErrorBody,
  parseJsonRequest,
  parseJsonRequestOptional,
} from "../api-contract";
import { apiErrorResponse } from "../api-response";

const schema = z.object({ id: z.string().uuid() }).strict();

test("API errors expose a stable contract and preserve the legacy error alias", () => {
  const requestId = "550e8400-e29b-41d4-a716-446655440000";
  assert.deepEqual(createApiErrorBody({
    code: API_ERROR_CODE.invalidRequest,
    message: "Solicitud inválida.",
    requestId,
  }), {
    code: "INVALID_REQUEST",
    correlationId: requestId,
    error: "Solicitud inválida.",
    message: "Solicitud inválida.",
    requestId,
    retryable: false,
    success: false,
  });
});

test("API error extensions preserve compatibility without overriding the shared contract", async () => {
  const requestId = "550e8400-e29b-41d4-a716-446655440000";
  const response = apiErrorResponse({
    code: API_ERROR_CODE.providerError,
    extensions: { code: "UNSAFE_OVERRIDE", hint: "Prueba una resolución menor." },
    message: "El proveedor rechazó la solicitud.",
    requestId,
    status: 502,
  });
  const body = await response.json();

  assert.equal(body.code, API_ERROR_CODE.providerError);
  assert.equal(body.hint, "Prueba una resolución menor.");
  assert.equal(response.headers.get("x-request-id"), requestId);
});

test("JSON parsing distinguishes malformed and oversized requests", async () => {
  const malformed = await parseJsonRequest(
    new Request("https://courseforge.test/api", { method: "POST", body: "{" }),
    schema,
    128,
  );
  assert.deepEqual(malformed, { reason: "invalid", success: false });

  const oversized = await parseJsonRequest(
    new Request("https://courseforge.test/api", {
      method: "POST",
      body: JSON.stringify({ id: "x".repeat(200) }),
    }),
    schema,
    32,
  );
  assert.deepEqual(oversized, { reason: "too_large", success: false });
});

test("JSON parsing returns schema-validated data", async () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const parsed = await parseJsonRequest(
    new Request("https://courseforge.test/api", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
    schema,
    128,
  );
  assert.deepEqual(parsed, { data: { id }, success: true });
});

test("optional JSON parsing accepts an empty body without removing byte limits", async () => {
  const empty = await parseJsonRequestOptional(
    new Request("https://courseforge.test/api", { method: "POST" }),
    schema,
    128,
  );
  assert.deepEqual(empty, { data: null, success: true });

  const oversized = await parseJsonRequestOptional(
    new Request("https://courseforge.test/api", { method: "POST", body: "x".repeat(129) }),
    schema,
    128,
  );
  assert.deepEqual(oversized, { reason: "too_large", success: false });
});
