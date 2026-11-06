import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { fixture, id, attemptId, identityErrors, tenantErrors, serviceErrors, type Stage } from "./render-authority-http.fixture";

for (const method of ["GET", "POST"] as const) {
  test(`${method}: autoridad segura en autorización y servicio antes de continuar`, async () => {
    const stages: Stage[] = ["identity", "tenant", "review", method === "GET" ? "recovery" : "submit"];
    for (const stage of stages) for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
      const context = fixture({ stage, failure: Object.assign(new Failure(), { message: "CANARIO_PRIVADO" }) });
      const response = await context.request(method); const body = await response.json();
      assert.equal(response.status, 503, `${stage}/${Failure.name}`); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE");
      assert.equal(body.retryable, true); assert.equal(body.requestId, "render-autoridad-test");
      assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary") || "", /Cookie/);
      assert.doesNotMatch(JSON.stringify([body, context.effects.filter(effect => effect.kind.startsWith("log."))]), /CANARIO_PRIVADO/);
      const index = context.effects.findIndex(effect => effect.kind === stage); assert.ok(index >= 0);
      assert.equal(context.effects.slice(index + 1).filter(effect => !effect.kind.startsWith("log.")).length, 0);
    }
  });
  test(`${method}: conserva denegaciones e impostores`, async () => {
    for (const deny of ["identity", "tenant", "review"] as const) {
      const context = fixture({ deny }); const response = await context.request(method);
      assert.equal(response.status, deny === "identity" ? 401 : 403);
      assert.equal(context.effects.filter(effect => ["admin", "submit", "recovery", "dispatch"].includes(effect.kind)).length, 0);
    }
    const response = await fixture({ stage: "identity", failure: Object.assign(new Error("Error ordinario"), { name: "TenantContextLookupError", code: "TENANT_LOOKUP_UNAVAILABLE" }) }).request(method);
    assert.equal(response.status, 500);
  });
  test(`${method}: respuesta válida anclada al actor y tenant vigentes`, async () => {
    const context = fixture(); const response = await context.request(method); assert.equal(response.status, method === "GET" ? 200 : 202);
    const body = await response.json(); assert.equal(body.data.renderRequestId, id);
    const review = context.effects.find(effect => effect.kind === "review.input")?.value as { userId: string; tenant: { organizationId: string } };
    assert.equal(review.userId, "actor"); assert.equal(review.tenant.organizationId, "organizacion-vigente");
    if (method === "GET") {
      assert.equal((context.effects.find(effect => effect.kind === "recovery.input")?.value as { organizationId: string }).organizationId, "organizacion-vigente");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    } else {
      const input = context.effects.find(effect => effect.kind === "submit.input")?.value as { organizationId: string; createdBy: string; deferProcessing: boolean; attemptId: string };
      assert.equal(input.organizationId, "organizacion-vigente"); assert.equal(input.createdBy, "actor"); assert.equal(input.deferProcessing, true); assert.equal(input.attemptId, attemptId);
      const dispatched = context.effects.find(effect => effect.kind === "dispatch.input")?.value as { name: string; payload: unknown };
      assert.equal(dispatched.name, "hyperframes-render-background"); assert.deepEqual(JSON.parse(JSON.stringify(dispatched.payload)), { renderRequestId: id });
    }
  });
}
test("POST: reutilización y providerRenderId existente evitan otro despacho", async () => {
  for (const options of [{ reused: true }, { providerRenderId: "proveedor" }]) {
    const context = fixture(options); const response = await context.request("POST");
    assert.equal(response.status, "reused" in options ? 200 : 202);
    assert.equal(context.effects.filter(effect => effect.kind === "dispatch").length, 0);
  }
});
test("POST: JSON, tamaño y autoridad/HTML/ZIP del payload se rechazan antes de servicios", async () => {
  for (const [overrides, status] of [[{ rawBody: "{" }, 400], [{ headers: { "content-length": "20000" } }, 413], [{ body: { revisionId: id, aspectRatio: "16:9", organizationId: "ajena" } }, 400], [{ body: { revisionId: id, aspectRatio: "16:9", html: "<html/>", zipUrl: "https://externo.test" } }, 400]] as const) {
    const context = fixture(); assert.equal((await context.request("POST", overrides)).status, status); assert.equal(context.effects.length, 0);
  }
});
test("GET: query inválida no consulta identidad y ausencia real conserva null válido", async () => {
  const invalid = fixture(); assert.equal((await invalid.request("GET", { query: "compositionId=inválido" })).status, 400); assert.equal(invalid.effects.length, 0);
  const response = await fixture({ emptyRecovery: true }).request("GET"); assert.equal(response.status, 200); assert.equal((await response.json()).data, null);
});
test("POST: errores de dominio conservan códigos y estado", async () => {
  for (const status of [400, 403, 404, 409, 422, 503]) {
    const response = await fixture({ stage: "submit", failure: new serviceErrors.HyperframesRenderSubmissionError("Mensaje de dominio.", status) }).request("POST");
    assert.equal(response.status, status); assert.equal((await response.json()).retryable, status === 503);
  }
});
test("GET: datos durables inválidos conservan 422 sin valores rechazados", async () => {
  const parsed = z.object({ id: z.uuid() }).safeParse({ id: "CANARIO_PRIVADO" }); assert.equal(parsed.success, false);
  if (parsed.success) return;
  const context = fixture({ stage: "recovery", failure: parsed.error }); const response = await context.request("GET");
  assert.equal(response.status, 422); assert.equal((await response.json()).details.reason, "RENDER_RECOVERY_DATA_INVALID");
  assert.doesNotMatch(JSON.stringify(context.effects), /CANARIO_PRIVADO/);
});
test("POST: dispatcher fallido se compensa antes de responder y no reenvía", async () => {
  for (const failure of [new Error("Worker no disponible"), new identityErrors.AuthIdentityLookupError(), new tenantErrors.TenantContextLookupError()]) {
    const context = fixture({ dispatchFailure: failure }); const response = await context.request("POST"); assert.equal(response.status, 503);
    assert.match((await response.json()).message, /worker de render/);
    const dispatched = context.effects.findIndex(effect => effect.kind === "dispatch");
    assert.ok(context.effects.findIndex(effect => effect.kind === "compensation") > dispatched);
    assert.equal(context.effects.filter(effect => effect.kind === "dispatch").length, 1);
    const value = context.effects.find(effect => effect.kind === "compensation.input")?.value as { organizationId: string; requestId: string };
    assert.equal(value.organizationId, "organizacion-vigente"); assert.equal(value.requestId, id);
  }
});
test("POST: caída conocida al compensar no afirma éxito durable", async () => {
  for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
    const context = fixture({ dispatchFailure: new Error("Worker no disponible"), compensationFailure: new Failure() });
    const response = await context.request("POST"); assert.equal(response.status, 503); assert.equal((await response.json()).success, false);
    assert.equal(context.effects.filter(effect => effect.kind === "compensation").length, 1);
  }
});
