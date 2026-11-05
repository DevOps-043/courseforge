import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlAuthenticatedReadHandler, type HtmlReadAuthentication } from "../../../domains/production/composition-editor/http/composition-html-authenticated-read-handler.server";
import { AuthIdentityLookupError } from "../../../lib/server/auth-identity-error";
import { TenantContextLookupError } from "../../../lib/server/tenant-context-error";

const actorId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const foreignOrganizationId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";

function scenario() {
  const effects: string[] = [];
  const rateKeys: string[] = [];
  const state = {
    enabled: true, failure: null as unknown, loggerThrows: false, allowed: true, rateError: false,
    authentication: { actorId, tenant: { userId: actorId, organizationId, platformRole: "ADMIN" } } as HtmlReadAuthentication,
    resultOrganizationId: organizationId,
  };
  const handler = createHtmlAuthenticatedReadHandler({
    enabled: () => state.enabled,
    authenticate: async () => { effects.push("authenticate"); if (state.failure) throw state.failure; return state.authentication; },
    serviceClient: () => {
      effects.push("admin");
      return { rpc: (_name: string, parameters: { p_rate_key: string }) => ({ abortSignal: async () => {
        effects.push("quota"); rateKeys.push(parameters.p_rate_key);
        return { error: state.rateError ? { message: "CANARIO_PRIVADO" } : null,
          data: [{ allowed: state.allowed, reset_at: "2026-11-05T00:00:00Z" }] };
      } }) } as unknown as SupabaseClient;
    },
    paramsSchema: z.object({ draftId: z.string().uuid() }).strict(),
    querySchema: z.object({ version: z.literal("1") }).strict(),
    resultSchema: z.object({ organizationId: z.string().uuid() }).strict(),
    policy: { maximumUrlBytes: 1024, timeoutMs: 1000, windowSeconds: 60,
      organizationRequests: 100, actorRequests: 10, maximumRateResponseBytes: 1024 },
    ratePrefix: "lectura-prueba", maximumResponseBytes: 1024,
    command: (_params, _query, owner) => owner,
    read: async (_client, owner) => { effects.push("read"); assert.equal(owner.actorId, actorId);
      assert.equal(owner.organizationId, state.authentication.tenant!.organizationId);
      return { organizationId: state.resultOrganizationId }; },
    matches: (result, owner) => result.organizationId === owner.organizationId,
    logFailure: () => { effects.push("log"); if (state.loggerThrows) throw new Error("CANARIO_PRIVADO_LOGGER"); },
  });
  const request = (query = "version=1", headers: Record<string, string> = {}, method = "GET") =>
    new Request(`https://engine.example/lectura?${query}`, { method, headers: { "x-request-id": requestId, ...headers } });
  return { state, effects, rateKeys, handler, request, params: { draftId: actorId } };
}

async function assertSafeFailure(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie, Authorization, Origin");
  const body = await response.json();
  assert.equal(body.requestId, requestId);
  assert.equal(body.correlationId, requestId);
  assert.equal(body.retryable, false);
  assert.doesNotMatch(JSON.stringify(body), /CANARIO_PRIVADO/);
}

for (const failure of [new AuthIdentityLookupError(), new TenantContextLookupError(), new Error("CANARIO_PRIVADO"),
  { name: "TenantContextLookupError", code: "TENANT_CONTEXT_UNAVAILABLE", message: "CANARIO_PRIVADO" }]) {
  test(`lectura delegada contiene fallo ${failure.constructor.name} antes del acceso privilegiado`, async () => {
    const f = scenario(); Object.assign(failure, { message: "CANARIO_PRIVADO" });
    f.state.failure = failure; f.state.loggerThrows = true;
    await assertSafeFailure(await f.handler(f.request(), f.params), 503);
    assert.deepEqual(f.effects, ["authenticate", "log"]);
  });
}

const denied: Array<[string, HtmlReadAuthentication, number]> = [
  ["sin identidad", { actorId: null, tenant: null }, 401],
  ["sin tenant", { actorId, tenant: null }, 403],
  ["tenant de otro actor", { actorId, tenant: { userId: organizationId, organizationId, platformRole: "ADMIN" } }, 403],
  ["actor inválido", { actorId: "inválido", tenant: { userId: "inválido", organizationId, platformRole: "ADMIN" } }, 403],
  ["organización inválida", { actorId, tenant: { userId: actorId, organizationId: "inválida", platformRole: "ADMIN" } }, 403],
  ["rol sin permiso", { actorId, tenant: { userId: actorId, organizationId, platformRole: "USER" } }, 403],
  ["rol ausente", { actorId, tenant: { userId: actorId, organizationId, platformRole: null } }, 403],
];
for (const [name, authentication, status] of denied) test(`lectura delegada rechaza ${name}`, async () => {
  const f = scenario(); f.state.authentication = authentication;
  await assertSafeFailure(await f.handler(f.request(), f.params), status);
  assert.deepEqual(f.effects, ["authenticate"]);
});

for (const role of ["ADMIN", "ARQUITECTO", "SUPERADMIN"]) test(`lectura delegada autoriza ${role} con cuotas del tenant actual`, async () => {
  const f = scenario(); f.state.authentication.tenant!.platformRole = role;
  const response = await f.handler(f.request(), f.params);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { organizationId });
  assert.deepEqual(f.effects, ["authenticate", "admin", "quota", "quota", "read"]);
  assert.deepEqual(f.rateKeys, [`lectura-prueba:org:${organizationId}`, `lectura-prueba:actor:${organizationId}:${actorId}`]);
});

test("lectura delegada no comparte autoridad ni resultado entre organizaciones", async () => {
  const f = scenario(); assert.equal((await f.handler(f.request(), f.params)).status, 200);
  f.state.authentication.tenant!.organizationId = foreignOrganizationId;
  await assertSafeFailure(await f.handler(f.request(), f.params), 503);
  f.state.resultOrganizationId = foreignOrganizationId;
  const response = await f.handler(f.request(), f.params);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.organizationId, foreignOrganizationId);
  assert.equal(f.rateKeys.at(-1), `lectura-prueba:actor:${foreignOrganizationId}:${actorId}`);
});

for (const [query, headers, method, status] of [
  ["version=1&version=1", {}, "GET", 400], ["version=1&organizationId=ajena", {}, "GET", 400],
  ["version=1", { origin: "https://foreign.example" }, "GET", 403],
  ["version=1", { "sec-fetch-site": "cross-site" }, "GET", 403], ["version=1", {}, "POST", 405],
] as const) test(`lectura delegada filtra entrada ${method}/${query}/${status}`, async () => {
  const f = scenario(); await assertSafeFailure(await f.handler(f.request(query, headers, method), f.params), status);
  assert.deepEqual(f.effects, []);
});

test("lectura delegada deshabilitada no consulta identidad", async () => {
  const f = scenario(); f.state.enabled = false;
  await assertSafeFailure(await f.handler(f.request(), f.params), 503); assert.deepEqual(f.effects, []);
});
for (const rateError of [false, true]) test(`lectura delegada detiene dominio ante cuota ${rateError ? "indisponible" : "agotada"}`, async () => {
  const f = scenario(); f.state.allowed = false; f.state.rateError = rateError;
  await assertSafeFailure(await f.handler(f.request(), f.params), rateError ? 503 : 429);
  assert.equal(f.effects.includes("read"), false); assert.equal(f.rateKeys.length, 1);
});
