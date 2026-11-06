import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthIdentityLookupError } from "../../../lib/server/auth-identity-error";
import { TenantContextLookupError } from "../../../lib/server/tenant-context-error";
import { HTML_ROUTE_CASES } from "./hyperframes-html-route.cases";
import { htmlRouteFixture, requiredHtmlRouteFlags } from "./hyperframes-html-route.fixture";

test("composición HTML conserva el corte de veinte rutas y veintisiete métodos", () => {
  assert.equal(HTML_ROUTE_CASES.length, 27);
  assert.equal(new Set(HTML_ROUTE_CASES.map(entry => entry.file)).size, 20);
});

for (const entry of HTML_ROUTE_CASES) {
  const label = `${entry.method} ${entry.file}`;
  test(`composición HTML reenvía request y params a su factory: ${label}`, async () => {
    const f = htmlRouteFixture(entry);
    const response = await f.handlers[entry.method]!(f.expectedRequest, { params: Promise.resolve(f.expectedParams) });
    assert.deepEqual(await response.json(), { factory: entry.factory, module: entry.module });
    assert.equal(f.options.serviceClient, f.blockedClient);
    assert.deepEqual(f.effects, []);
  });
  test(`composición HTML obtiene identidad y tenant actuales: ${label}`, async () => {
    const f = htmlRouteFixture(entry);
    const first = await f.options.authenticate();
    assert.equal(first.actorId, "actor-vigente"); assert.equal(first.tenant, f.state.tenant);
    f.state.actorId = "actor-siguiente";
    f.state.tenant = { userId: f.state.actorId, organizationId: "empresa-siguiente", platformRole: "ARQUITECTO" };
    const second = await f.options.authenticate();
    assert.equal(second.actorId, f.state.actorId); assert.equal(second.tenant, f.state.tenant);
    assert.deepEqual(f.effects, ["session", "identity", "tenant", "session", "identity", "tenant"]);
    f.effects.length = 0; f.state.actorId = null;
    const unauthenticated = await f.options.authenticate();
    assert.equal(unauthenticated.actorId, null); assert.equal(unauthenticated.tenant, null);
    assert.deepEqual(f.effects, ["session", "identity"]);
  });
  test(`composición HTML propaga fallos de autoridad a la frontera HTTP: ${label}`, async () => {
    for (const stage of ["identity", "tenant"] as const) for (const failure of [new AuthIdentityLookupError(), new TenantContextLookupError()]) {
      const f = htmlRouteFixture(entry);
      if (stage === "identity") f.state.identityFailure = failure;
      else f.state.tenantFailure = failure;
      await assert.rejects(f.options.authenticate(), error => error === failure);
      assert.deepEqual(f.effects, stage === "identity" ? ["session", "identity"] : ["session", "identity", "tenant"]);
    }
  });
  test(`composición HTML mantiene rollout explícito y lectura independiente: ${label}`, () => {
    const f = htmlRouteFixture(entry); const flags = requiredHtmlRouteFlags(entry);
    assert.equal(f.options.enabled(entry.method), false);
    for (const key of flags) f.environment[key] = "true";
    assert.equal(f.options.enabled(entry.method), true);
    for (const key of flags) {
      for (const value of [undefined, "false", "TRUE", " true ", "1"]) {
        f.environment[key] = value; assert.equal(f.options.enabled(entry.method), false, `${key}=${value}`);
      }
      f.environment[key] = "true";
    }
    assert.deepEqual(f.effects, []);
  });
}
