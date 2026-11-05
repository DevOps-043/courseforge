import assert from "node:assert/strict";
import { test } from "node:test";
import { cases, fixture, identityErrors, tenantErrors, runErrors, runId, componentId, artifactId, presetId, avatar, type Gate } from "./automation-authority-http.fixture";

for (const operation of cases) {
  const [route, method] = operation;
  const label = `${method} ${route}`;
  const gates: Gate[] = ["identity", "tenant", "review", ...(route === "runs" && method === "POST" ? ["artifact" as const] : [])];
  test(`${label}: ambas clases de autoridad devuelven 503 antes de efectos posteriores`, async () => {
    for (const gate of gates) for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
      const context = fixture(operation, { gate, failure: Object.assign(new Failure(), { message: "CANARIO_PRIVADO" }) });
      const response = await context.request();
      assert.equal(response.status, 503, `${gate}/${Failure.name}`);
      const body = await response.json();
      assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
      assert.equal(body.requestId, "automatizacion-autoridad-test");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("vary") || "", /Cookie/);
      assert.doesNotMatch(JSON.stringify([body, context.effects.filter(effect => effect.kind.startsWith("log."))]), /CANARIO_PRIVADO/);
      const failureIndex = context.effects.findIndex(effect => effect.kind === gate);
      assert.ok(failureIndex >= 0);
      assert.equal(context.effects.slice(failureIndex + 1).filter(effect => !effect.kind.startsWith("log.")).length, 0);
    }
  });
  test(`${label}: conserva 401/403 y rechaza metadata impostora`, async () => {
    for (const deny of ["identity", "tenant", "review"] as const) {
      const context = fixture(operation, { deny });
      assert.equal((await context.request()).status, deny === "identity" ? 401 : 403);
      assert.equal(context.effects.filter(effect => ["admin", "query", "service", "scenes", "dispatch"].includes(effect.kind)).length, 0);
    }
    const context = fixture(operation, { gate: "identity", failure: Object.assign(new Error("Error ordinario"), { name: "TenantContextLookupError", code: "TENANT_LOOKUP_UNAVAILABLE" }) });
    const response = await context.request();
    assert.equal(response.status, route.endsWith("dispatch") ? 503 : 500);
    assert.equal(response.headers.get("cache-control"), null);
  });
  test(`${label}: conserva DTO y atribución del servidor`, async () => {
    const context = fixture(operation);
    const response = await context.request();
    assert.equal(response.status, (route === "runs" && method === "POST") || route.endsWith("dispatch") ? 202 : 200);
    const body = await response.json(); assert.equal(body.success, true);
    const review = context.effects.find(effect => effect.kind === "review.input")?.value as { userId: string; tenant: { organizationId: string } };
    assert.equal(review.userId, "actor"); assert.equal(review.tenant.organizationId, "organizacion-vigente");
    for (const filter of context.effects.filter(effect => effect.kind === "filter")) {
      const value = filter.value as { column: string; value: unknown };
      if (value.column === "organization_id") assert.equal(value.value, "organizacion-vigente");
    }
    for (const [index, effect] of context.effects.entries()) {
      if (effect.kind !== "query" || !["production_runs", "production_run_items"].includes(String(effect.value))) continue;
      const nextQuery = context.effects.findIndex((entry, position) => position > index && entry.kind === "query");
      const queryEffects = context.effects.slice(index + 1, nextQuery < 0 ? undefined : nextQuery);
      assert.ok(queryEffects.some(entry => entry.kind === "filter" && (entry.value as { column: string }).column === "organization_id"), `consulta ${String(effect.value)} sin organización`);
    }
    if (route === "runs" && method === "POST") {
      assert.deepEqual(JSON.parse(JSON.stringify(context.effects.find(effect => effect.kind === "create")?.value)), { artifactId, createdBy: "actor", organizationId: "organizacion-vigente" });
    } else if (route.endsWith("configuration")) {
      assert.equal(body.approved, false);
      const updates = context.effects.filter(effect => effect.kind === "update"); assert.equal(updates.length, 2);
      const runUpdate = updates[1].value as { value: { configuration: { configured_by: string; defaults: { nativeCaptions: boolean }; approval_state: string } } };
      assert.equal(runUpdate.value.configuration.configured_by, "actor");
      assert.equal(runUpdate.value.configuration.defaults.nativeCaptions, true);
      assert.equal(runUpdate.value.configuration.approval_state, "DRAFT");
    } else if (route.endsWith("dispatch")) {
      assert.equal(body.submissionStatus, "QUEUED");
      assert.deepEqual(JSON.parse(JSON.stringify(context.effects.find(effect => effect.kind === "sign")?.value)), { organizationId: "organizacion-vigente", runId });
      assert.equal(context.effects.filter(effect => effect.kind === "worker").length, 0);
    } else if (route.endsWith("clips")) {
      assert.equal(body.data.clips.length, 1);
      if (method === "PUT") { assert.equal(body.data.clips[0].avatar_preset_id, presetId); assert.equal(body.data.clips[0].voice_preset_id, presetId); }
    } else if (method === "GET") {
      assert.equal(body.data.id, runId);
      if (route !== "runs") assert.equal((context.effects.find(effect => effect.kind === "get")?.value as { organizationId: string }).organizationId, "organizacion-vigente");
    }
    else {
      const refresh = context.effects.find(effect => effect.kind === "refresh")?.value as { organizationId: string; input: { userId: string } };
      assert.equal(refresh.organizationId, "organizacion-vigente"); assert.equal(refresh.input.userId, "actor");
    }
  });
}

for (const operation of [cases[1], cases[3], cases[4], cases[7]]) {
  test(`${operation.join(" ")}: conserva 400/413 y límites de JSON`, async () => {
    for (const overrides of [{ rawBody: "{" }, { headers: { "content-length": "300000" } }]) {
      const context = fixture(operation);
      assert.equal((await context.request(overrides)).status, "rawBody" in overrides ? 400 : 413);
      assert.equal(context.effects.filter(effect => ["create", "refresh", "update", "build", "save"].includes(effect.kind)).length, 0);
    }
    assert.equal((await fixture(operation).request({ body: { organizationId: "ajena", createdBy: "intruso" } })).status, 400);
  });
}
test("lista: UUID inválido se rechaza antes de identidad", async () => {
  const context = fixture(cases[0]); assert.equal((await context.request({ query: "artifactId=inválido" })).status, 400);
  assert.equal(context.effects.length, 0);
});
for (const operation of cases.filter(([route]) => route !== "runs")) {
  test(`${operation.join(" ")}: runId inválido no ejecuta la operación`, async () => {
    const context = fixture(operation); assert.equal((await context.request({ run: "inválido" })).status, 400);
    assert.equal(context.effects.filter(effect => ["get", "refresh", "query", "sign", "build", "save", "update"].includes(effect.kind)).length, 0);
  });
}
test("creación: artefacto ausente o de otra organización conserva 404", async () => {
  for (const options of [{ deny: "artifact" as const }, { wrongArtifact: true }]) {
    const context = fixture(cases[1], options); assert.equal((await context.request()).status, 404);
    assert.equal(context.effects.filter(effect => effect.kind === "service").length, 0);
  }
});
for (const operation of [cases[1], cases[2], cases[3]]) {
  test(`${operation.join(" ")}: conserva errores de dominio 400/404/409`, async () => {
    for (const status of [400, 404, 409]) {
      const response = await fixture(operation, { serviceFailure: new runErrors.ProductionAutomationRunError("Error de dominio.", status) }).request();
      assert.equal(response.status, status);
      assert.equal((await response.json()).code, status === 404 ? "RESOURCE_NOT_FOUND" : status === 409 ? "CONFLICT" : "INVALID_REQUEST");
    }
  });
}
test("refresh: confirma overwrite con actor del servidor", async () => {
  const context = fixture(cases[3]);
  const overwriteCaptions = { itemId: componentId, clipId: "clip", documentHash: "a".repeat(64) };
  assert.equal((await context.request({ body: { overwriteCaptions } })).status, 200);
  const refresh = context.effects.find(effect => effect.kind === "refresh")?.value as { input: { userId: string; overwriteCaptions: unknown } };
  assert.equal(refresh.input.userId, "actor"); assert.deepEqual(JSON.parse(JSON.stringify(refresh.input.overwriteCaptions)), overwriteCaptions);
});
test("configuración: run ausente o componente ajeno no se escribe", async () => {
  for (const [options, status] of [[{ missingRun: true }, 404], [{ missingItem: true }, 400]] as const) {
    const context = fixture(cases[4], options); assert.equal((await context.request()).status, status);
    assert.equal(context.effects.filter(effect => effect.kind === "update").length, 0);
  }
});
test("configuración: aprobación incompleta sin items no modifica el run", async () => {
  const context = fixture(cases[4]);
  const response = await context.request({ body: { approve: true, items: [] } });
  assert.equal(response.status, 400); assert.equal((await response.json()).details.incomplete.length, 1);
  assert.equal(context.effects.filter(effect => effect.kind === "update").length, 0);
});
test("configuración: aprobación explícita mantiene configured_by y defaults", async () => {
  const context = fixture(cases[4]);
  const response = await context.request({ body: { approve: true, defaults: { avatar }, items: [] } });
  assert.equal(response.status, 200); assert.equal((await response.json()).approved, true);
  const update = context.effects.find(effect => effect.kind === "update")?.value as { value: { configuration: { approval_state: string; configured_by: string } } };
  assert.equal(update.value.configuration.approval_state, "APPROVED"); assert.equal(update.value.configuration.configured_by, "actor");
});
test("configuración: error de escritura no se reporta como éxito", async () => {
  const context = fixture(cases[4], { updateFailure: true });
  assert.equal((await context.request()).status, 500);
  assert.equal(context.effects.filter(effect => effect.kind === "update").length, 1);
});
for (const operation of [cases[6], cases[7]]) {
  test(`${operation.join(" ")}: clips de componente/run ajeno conservan 404 sin servicio`, async () => {
    for (const options of [{ missingItem: true }, { missingComponent: true }]) {
      const context = fixture(operation, options); assert.equal((await context.request()).status, 404);
      assert.equal(context.effects.filter(effect => effect.kind === "scenes").length, 0);
    }
    const invalid = fixture(operation); assert.equal((await invalid.request({ component: "inválido" })).status, 400);
  });
}
test("despacho: callback local usa organización del servidor", async () => {
  const context = fixture(cases[5]); assert.equal((await context.request({ body: { organizationId: "ajena" } })).status, 202);
  const dispatch = context.effects.find(effect => effect.kind === "dispatch")?.value as { callbacks: { localHandlerLoader: () => Promise<{ handler: () => Promise<{ statusCode: number }> }> } };
  assert.equal((await (await dispatch.callbacks.localHandlerLoader()).handler()).statusCode, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(context.effects.find(effect => effect.kind === "worker")?.value)), { organizationId: "organizacion-vigente", runId });
});
test("despacho: fallo de worker conserva respuesta de dependencia", async () => {
  const response = await fixture(cases[5], { dispatchFailure: new Error("CANARIO_PRIVADO") }).request();
  assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(await response.json()), /CANARIO_PRIVADO/);
});
test("consulta: fallo de DB conserva 500 y no se convierte en lista vacía", async () => {
  const response = await fixture(cases[0], { queryFailure: true }).request();
  assert.equal(response.status, 500); assert.equal((await response.json()).success, false);
});
