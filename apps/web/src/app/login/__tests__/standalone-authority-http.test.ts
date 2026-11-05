import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, organizationId, otherOrganizationId, videoId, componentId, assetId, clock, identityErrors, tenantErrors, credentials, heygenApi, mediaErrors, type Gate } from "./standalone-authority-http.fixture";

for (const operation of ["create", "status", "media"] as const) {
  test(`${operation}: autoridad no disponible devuelve 503 seguro sin efectos posteriores`, async () => {
    const gates: Gate[] = operation === "media" ? ["identity", "component", "register"] : ["identity", "review", "tenant"];
    for (const gate of gates) for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
      const context = fixture(operation, { gate, failure: Object.assign(new Failure(), { message: "CANARIO_PRIVADO" }) });
      const response = await context.request(); const body = await response.json();
      assert.equal(response.status, 503, `${gate}/${Failure.name}`); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE");
      assert.equal(body.retryable, true); assert.ok(body.requestId);
      assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary") || "", /Cookie/);
      assert.doesNotMatch(JSON.stringify([body, context.logs]), /CANARIO_PRIVADO/);
      const failureIndex = context.effects.findIndex(effect => effect.kind === gate); assert.ok(failureIndex >= 0);
      assert.equal(context.effects.slice(failureIndex + 1).length, 0);
    }
  });
  test(`${operation}: conserva denegaciones y metadata falsa no pasa por clase`, async () => {
    const denied = await fixture(operation, { deny: "identity" }).request();
    assert.equal(denied.status, 401);
    if (operation !== "media") {
      assert.equal(denied.headers.get("cache-control"), "private, no-store"); assert.match(denied.headers.get("vary") || "", /Cookie/);
    }
    if (operation === "media") assert.equal((await fixture(operation, { deny: "component" }).request()).status, 404);
    else for (const deny of ["review", "tenant"] as const) assert.equal((await fixture(operation, { deny }).request()).status, 403);
    assert.equal((await fixture(operation, { gate: "identity", failure: Object.assign(new Error("Error ordinario"), { name: "AuthIdentityLookupError", code: "AUTH_LOOKUP_UNAVAILABLE" }) }).request()).status, 500);
  });
}
test("IDs sin comprobante, ajenos, alterados o expirados se deniegan antes de credenciales", async () => {
  for (const options of [{ token: null }, { token: "falso" }, { tokenOrganization: otherOrganizationId }, { tokenVideo: "video-ajeno" }, { tokenIssuedAt: clock - 7 * 24 * 60 * 60 * 1000 - 1 }]) {
    const context = fixture("status", options); const response = await context.request();
    assert.equal(response.status, 404); assert.equal((await response.json()).code, "RESOURCE_NOT_FOUND");
    assert.equal(context.effects.filter(effect => ["admin", "credentials", "getVideo"].includes(effect.kind)).length, 0);
  }
});
test("crear y consultar repetidamente conserva vínculo aunque el cliente del proveedor se comparta", async () => {
  const created = fixture("create"); const response = await created.request(); assert.equal(response.status, 200);
  const initialJob = (await response.json()).data; assert.equal(initialJob.standalone, true); assert.equal(initialJob.status, "WAITING_PROVIDER");
  assert.equal(typeof initialJob.standaloneAccessToken, "string");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("vary") || "", /Cookie/);
  let currentJob = initialJob;
  for (let index = 0; index < 2; index++) {
    const status = fixture("status"); const result = await status.request({ token: currentJob.standaloneAccessToken });
    assert.equal(result.status, 200); currentJob = (await result.json()).data;
    assert.equal(currentJob.standaloneAccessToken, initialJob.standaloneAccessToken);
    assert.equal(currentJob.status, "SUCCEEDED"); assert.equal(currentJob.asset.id, videoId);
    assert.equal(result.headers.get("cache-control"), "private, no-store");
    assert.equal(status.effects.filter(effect => effect.kind === "getVideo").length, 1);
  }
  const intruder = fixture("status", { organization: otherOrganizationId });
  assert.equal((await intruder.request({ token: initialJob.standaloneAccessToken })).status, 404);
  assert.equal(intruder.effects.filter(effect => effect.kind === "getVideo").length, 0);
  const input = created.effects.find(effect => effect.kind === "createVideo")?.value as { input: { callback_id: string }; idempotencyKey: string };
  assert.equal(input.input.callback_id, `standalone-${organizationId}`); assert.match(input.idempotencyKey, new RegExp(organizationId));
  const credentialInput = created.effects.find(effect => effect.kind === "credentials")?.value as { organizationId: string; allowGlobalFallback: boolean };
  assert.equal(credentialInput.organizationId, organizationId); assert.equal(credentialInput.allowGlobalFallback, false);
});
for (const operation of ["create", "status"] as const) {
  test(`${operation}: revisión y comprobante usan la misma organización vigente`, async () => {
    const context = fixture(operation); assert.equal((await context.request()).status, 200);
    const review = context.effects.find(effect => effect.kind === "review.input")?.value as { userId: string; tenant: { organizationId: string } };
    assert.equal(review.userId, "actor"); assert.equal(review.tenant.organizationId, organizationId);
    assert.equal(context.effects.find(effect => effect.kind === "access")?.value, review.tenant.organizationId);
  });
  test(`${operation}: firma no disponible no llama al proveedor ni expone detalles`, async () => {
    const context = fixture(operation, { keyFailure: true }); const response = await context.request();
    assert.equal(response.status, 503); const body = await response.json(); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
    assert.doesNotMatch(JSON.stringify([body, context.logs]), /CANARIO_PRIVADO/);
    assert.equal(context.effects.filter(effect => ["admin", "avatar", "credentials", "getVideo", "createVideo"].includes(effect.kind)).length, 0);
  });
  test(`${operation}: mantiene credenciales y Retry-After del proveedor`, async () => {
    const credential = fixture(operation, { credentialFailure: new credentials.HeygenCredentialResolverError("Configura HeyGen.") });
    assert.equal((await credential.request()).status, 409);
    const provider = fixture(operation, { providerFailure: new heygenApi.HeygenApiError({ message: "CANARIO_PRIVADO", status: 429, retryAfterSeconds: 12 }) });
    const response = await provider.request(); assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "12");
    assert.doesNotMatch(JSON.stringify(await response.json()), /CANARIO_PRIVADO/);
  });
}
test("status: identidad/rol revocados invalidan consulta aunque el comprobante sea válido", async () => {
  for (const deny of ["identity", "review", "tenant"] as const) {
    const context = fixture("status", { deny }); assert.equal((await context.request()).status, deny === "identity" ? 401 : 403);
    assert.equal(context.effects.filter(effect => effect.kind === "access").length, 0);
  }
});
test("status: ID distinto del proveedor no expone asset o URL", async () => {
  const response = await fixture("status", { returnedVideoId: "video-ajeno" }).request(); assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(await response.json()), /https:|video-ajeno/);
});
for (const [status, expected] of [["pending", "WAITING_PROVIDER"], ["failed", "FAILED"]] as const) {
  test(`status: conserva ${expected} sin asset`, async () => {
    const response = await fixture("status", { status }).request(); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.data.status, expected); assert.equal(body.data.asset, null);
  });
}
test("create: validación, tamaños, presets y payload sin autoridad", async () => {
  for (const [overrides, expected] of [[{ rawBody: "{" }, 400], [{ headers: { "content-length": "200000" } }, 413], [{ body: { title: "Vídeo", script: "Un guion de prueba con suficiente texto.", organizationId: otherOrganizationId } }, 400]] as const) {
    const context = fixture("create"); assert.equal((await context.request(overrides)).status, expected); assert.equal(context.effects.length, 0);
  }
  assert.equal((await fixture("create", { missingAvatar: true }).request()).status, 400);
  assert.equal((await fixture("create", { missingVoice: true }).request()).status, 400);
});
test("media: conserva DTO, actor/componente y errores 400/404/422", async () => {
  const context = fixture("media"); const response = await context.request(); assert.equal(response.status, 200); assert.equal((await response.json()).assetId, assetId);
  const registered = context.effects.find(effect => effect.kind === "registration.input")?.value as { userId: string; input: { componentId: string } };
  assert.equal(registered.userId, "actor"); assert.equal(registered.input.componentId, componentId);
  assert.equal((await fixture("media").request({ body: { componentId } })).status, 400);
  assert.equal((await fixture("media", { gate: "register", failure: new mediaErrors.StandaloneMediaValidationError("Formato no válido.") }).request()).status, 422);
});
