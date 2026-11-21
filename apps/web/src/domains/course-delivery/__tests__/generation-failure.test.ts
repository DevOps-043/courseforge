import { test } from "node:test";
import assert from "node:assert/strict";
import { DELIVERY_LIMITS, deliveryGenerationTimeout, deliveryUnitBudget } from "../config/delivery.config";
import { deliveryGenerationFailure } from "../lib/delivery-generation-failure";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { materialGenerationError } from "../../../lib/material-generation-error";
import { sourceGroundingFailure } from "../../course-sources/course-source-error";

test("ambos flujos conservan los cuatro motivos específicos sin exponer citas ni el mensaje privado", () => {
  for (const reason of ["UNSUPPORTED_OUTPUT", "SOURCE_NOT_IN_CONTEXT", "QUOTE_NOT_IN_SOURCE", "CLAIM_NOT_IN_OUTPUT"]) {
    const error = { status: 409, groundingReason: reason, message: "cita privada" };
    for (const diagnostic of [sourceGroundingFailure(error), materialGenerationError(error, "GROUNDING"), deliveryGenerationFailure(error, "GROUNDING", 180_000)]) {
      assert.equal(diagnostic.code, reason);
      assert.doesNotMatch(diagnostic.message, /cita privada|GROUNDING_REJECTED|GROUNDING_FAILED/);
    }
  }
  assert.equal(materialGenerationError({ groundingReason: "cita privada" }, "GROUNDING").code, "GROUNDING_UNAVAILABLE");
});

test("Materiales tiene presupuesto propio y el respaldo cabe dentro de la ejecución", () => {
  assert.equal(deliveryGenerationTimeout("MATERIALS"), 180_000);
  assert.equal(deliveryGenerationTimeout("PLAN"), 90_000);
  assert.equal(deliveryGenerationTimeout("AGENDA"), 90_000);
  assert.equal(deliveryUnitBudget("MATERIALS", true), 495_000);
  assert.ok(deliveryUnitBudget("MATERIALS", true) < DELIVERY_LIMITS.runBudgetMs);
  assert.equal(deliveryUnitBudget("MATERIALS", false), 315_000);
});

test("el diagnóstico diferencia timeout de generación y de auditoría sin divulgar contenido", () => {
  const failure = new DOMException("prompt privado", "TimeoutError");
  const generation = deliveryGenerationFailure(failure, "GENERATION", 180_000);
  assert.equal(generation.code, "TIMEOUT");
  assert.match(generation.message, /180 segundos/);
  assert.doesNotMatch(generation.message, /prompt privado/);
  const grounding = deliveryGenerationFailure(failure, "GROUNDING", 180_000);
  assert.match(grounding.message, /Comprobación de respaldo/);
  assert.doesNotMatch(grounding.message, /180 segundos/);
});

test("el diagnóstico conserva las categorías de validación, contexto y proveedor", () => {
  assert.equal(deliveryGenerationFailure({ name: "ZodError" }, "VALIDATION", 180_000).code, "INVALID_OUTPUT");
  assert.equal(deliveryGenerationFailure({ status: 413 }, "PREPARATION", 180_000).code, "CONTEXT_BUDGET");
  assert.equal(deliveryGenerationFailure({ statusCode: 429 }, "GENERATION", 180_000).code, "PROVIDER_LIMIT");
  assert.equal(deliveryGenerationFailure({ statusCode: 403 }, "GENERATION", 180_000).code, "PROVIDER_CONFIGURATION");
});

test("el handler informa el resultado del worker y vuelve a despachar los reintentos en cola", async () => {
  for (const status of ["FAILED", "COMPLETED", "PAUSED", "NOT_CLAIMED", "QUEUED"]) {
    const dispatched: unknown[] = [];
    const { handler } = load<{ handler: (event: { httpMethod: string }) => Promise<{ statusCode: number; body: string }> }>("netlify/functions/course-delivery-background.ts", {
      "./shared/http": {
        parseVerifiedBackgroundBody: async () => ({ runId: "10000000-0000-4000-8000-000000000001" }),
        jsonResponse: (body: unknown, statusCode = 200) => ({ statusCode, body: JSON.stringify(body) }),
      },
      "./shared/bootstrap": { createServiceRoleClient: () => ({}) },
      "../../src/lib/server/background-function-client": { dispatchBackgroundFunctionJson: async (name: string, payload: { runId: string }, options: { localHandlerLoader: () => Promise<{ handler: unknown }> }) => {
        dispatched.push({ name, runId: payload.runId, handler: (await options.localHandlerLoader()).handler });
      } },
      "../../src/domains/course-delivery/services/delivery-generation": {
        executeDeliveryRun: async () => ({ status, runId: "run" }),
      },
    });
    const response = await handler({ httpMethod: "POST" });
    assert.equal(response.statusCode, status === "FAILED" ? 503 : 200);
    assert.equal(JSON.parse(response.body).success, status !== "FAILED");
    assert.deepEqual(dispatched, status === "QUEUED" ? [{ name: "course-delivery-background", runId: "run", handler }] : []);
  }
});
