import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthIdentityLookupError } from "../../../lib/server/auth-identity-error";
import { TenantContextLookupError } from "../../../lib/server/tenant-context-error";
import { SHARED_ROUTE_CASES } from "./hyperframes-shared-route.cases";
import { HTML_ROUTE_CASES } from "./hyperframes-html-route.cases";
import { sharedRouteFixture, sharedActorId, sharedOrganizationId, type SharedRouteCase } from "./hyperframes-shared-route.fixture";

function enableOrganization(environment: Record<string, string | undefined>) {
  environment.NARRATIVE_EXTRACTION_ORGANIZATION_IDS = sharedOrganizationId;
  environment.NARRATIVE_FRAGMENT_ORGANIZATION_IDS = sharedOrganizationId;
}
function requiredFlags(entry: SharedRouteCase) {
  if (entry.handler === "FRAGMENT_PLAN") return [];
  if (/^(EXTRACTION|FRAGMENT):/.test(entry.handler)) {
    const prefix = entry.handler.startsWith("EXTRACTION:") ? "NARRATIVE_EXTRACTION" : "NARRATIVE_FRAGMENT";
    return [`${prefix}_ATOMIC_RECEIPTS_READY`, ...(entry.handler.endsWith("APPLY") ? [`${prefix}_ENABLED`] : [])];
  }
  return ["COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED", ...(entry.handler.startsWith("RECONSTRUCTION:")
    ? ["COMPOSITION_HTML_RECONSTRUCTION_OPENING_ENABLED", ...(entry.method === "POST"
      ? ["COMPOSITION_HTML_RECONSTRUCTION_RESOURCE_LINK_ENABLED", "COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED"] : [])] : [])];
}
test("composición delegada completa el inventario de treinta rutas y treinta y ocho métodos", () => {
  assert.equal(SHARED_ROUTE_CASES.length, 11);
  assert.equal(new Set(SHARED_ROUTE_CASES.map(entry => entry.file)).size, 10);
  const all = [...HTML_ROUTE_CASES, ...SHARED_ROUTE_CASES];
  assert.equal(all.length, 38); assert.equal(new Set(all.map(entry => entry.file)).size, 30);
});
for (const entry of SHARED_ROUTE_CASES) {
  const label = `${entry.method} ${entry.file}`;
  test(`raíz compartida conecta factory y params reales: ${label}`, async () => {
    const f = sharedRouteFixture(entry);
    const response = await f.handlers[entry.method]!(f.request, { params: Promise.resolve(f.params) });
    assert.deepEqual(await response.json(), { handler: entry.handler });
    assert.deepEqual(f.effects, []);
    if (f.options.serviceClient) assert.equal(f.options.serviceClient, f.blockedClient);
    if (entry.handler.startsWith("PREVIEW:")) assert.equal(f.options.responseKind, entry.handler.slice("PREVIEW:".length));
  });
  test(`raíz compartida aplica flags estrictos sin activar escrituras: ${label}`, () => {
    const f = sharedRouteFixture(entry); const flags = requiredFlags(entry);
    if (!flags.length) { assert.equal(f.options.enabled, undefined); return; }
    assert.equal(f.options.enabled!(entry.method), false);
    for (const key of flags) f.environment[key] = "true";
    assert.equal(f.options.enabled!(entry.method), true);
    for (const key of flags) {
      for (const value of [undefined, "false", "TRUE", " true ", "1"]) {
        f.environment[key] = value; assert.equal(f.options.enabled!(entry.method), false, `${key}=${value}`);
      }
      f.environment[key] = "true";
    }
    assert.deepEqual(f.effects, []);
  });
  if (entry.handler !== "RESOURCE") {
    test(`raíz compartida deriva autoridad actual por solicitud: ${label}`, async () => {
      const f = sharedRouteFixture(entry); enableOrganization(f.environment);
      if (f.options.authorize) {
        const authorized = await f.options.authorize();
        assert.equal(authorized.status, "AUTHORIZED"); assert.equal(authorized.userId, sharedActorId);
        assert.equal(authorized.organizationId, sharedOrganizationId);
        assert.deepEqual(f.effects, ["session", "identity", "tenant", "review"]);
      } else {
        const authenticated = await f.options.authenticate!();
        assert.equal(authenticated.actorId, sharedActorId); assert.equal(authenticated.tenant, f.state.tenant);
        assert.deepEqual(f.effects, ["session", "identity", "tenant"]);
      }
      f.effects.length = 0; f.state.actorId = null;
      if (f.options.authorize) assert.equal((await f.options.authorize()).status, "AUTH_REQUIRED");
      else {
        const authenticated = await f.options.authenticate!(); assert.equal(authenticated.actorId, null); assert.equal(authenticated.tenant, null);
      }
      assert.deepEqual(f.effects, ["session", "identity"]);
    });
    test(`raíz compartida propaga error antes de efectos privilegiados: ${label}`, async () => {
      const stages = /^(EXTRACTION|FRAGMENT)/.test(entry.handler) ? ["identity", "tenant", "review"] as const : ["identity", "tenant"] as const;
      for (const stage of stages) for (const failure of [new AuthIdentityLookupError(), new TenantContextLookupError()]) {
        const f = sharedRouteFixture(entry); enableOrganization(f.environment);
        if (stage === "identity") f.state.identityFailure = failure;
        else if (stage === "tenant") f.state.tenantFailure = failure;
        else f.state.reviewFailure = failure;
        await assert.rejects((f.options.authorize ?? f.options.authenticate)!(), error => error === failure);
        assert.deepEqual(f.effects, ["session", "identity", ...(stage !== "identity" ? ["tenant"] : []), ...(stage === "review" ? ["review"] : [])]);
      }
    });
  }
  if (/^(EXTRACTION|FRAGMENT)/.test(entry.handler)) test(`raíz narrativa rechaza tenant ajeno y respeta allowlist por modo: ${label}`, async () => {
    const f = sharedRouteFixture(entry); enableOrganization(f.environment);
    f.state.tenant!.userId = "actor-ajeno";
    assert.equal((await f.options.authorize!()).status, "TENANT_FORBIDDEN"); assert.equal(f.effects.includes("review"), false);
    f.state.tenant!.userId = sharedActorId; f.state.reviewAllowed = false;
    assert.equal((await f.options.authorize!()).status, "ROLE_FORBIDDEN"); f.state.reviewAllowed = true;
    delete f.environment.NARRATIVE_EXTRACTION_ORGANIZATION_IDS; delete f.environment.NARRATIVE_FRAGMENT_ORGANIZATION_IDS;
    assert.equal((await f.options.authorize!()).status, entry.handler.endsWith("APPLY") ? "ROLE_FORBIDDEN" : "AUTHORIZED");
    assert.equal(f.effects.includes("admin"), false);
  });
  if (entry.handler.startsWith("PREVIEW:") || entry.handler === "RESOURCE") test(`preview usa configuración de operador y protocolo previsto: ${label}`, () => {
    const f = sharedRouteFixture(entry);
    assert.throws(() => f.options.configuration!(), /HTML_PREVIEW_DELIVERY_NOT_CONFIGURED/);
    f.environment.COMPOSITION_HTML_EDITING_PREVIEW_DELIVERY_KEY = "12".repeat(32);
    f.environment.COMPOSITION_HTML_EDITING_PREVIEW_PARENT_ORIGIN = "https://engine.example";
    f.environment.NEXT_PUBLIC_SUPABASE_URL = "https://storage.example";
    const config = f.options.configuration!();
    assert.equal(config.audience, "https://engine.example"); assert.equal(config.storageOrigin, "https://storage.example");
    assert.equal(Buffer.from(config.key).toString("hex"), "12".repeat(32));
    if (entry.handler === "RESOURCE") { assert.equal(f.options.authenticate, undefined); assert.equal(f.options.authorize, undefined); }
    else assert.equal(config.runtimeWebRoot, "runtime-sintetico");
    assert.deepEqual(f.effects, []);
  });
}
