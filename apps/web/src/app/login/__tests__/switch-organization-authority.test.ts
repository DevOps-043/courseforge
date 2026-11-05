import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT, jwtVerify } from "jose";
import { load } from "./source-test-loader";
import type { NextRequest } from "next/server";

const actorId = "123e4567-e89b-42d3-a456-426614174000";
const ownId = "123e4567-e89b-42d3-a456-426614174001";
const oldId = "123e4567-e89b-42d3-a456-426614174002";
const secret = "secreto-sintetico-exclusivo-de-pruebas";
const key = new TextEncoder().encode(secret);
const errorModule = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const roles = load<typeof import("../../../utils/auth/platform-role")>("src/utils/auth/platform-role.ts");
const expiration = load<typeof import("../../../utils/auth/session-expiration")>("src/utils/auth/session-expiration.ts");
const contract = load<typeof import("../../../lib/server/api-contract")>("src/lib/server/api-contract.ts");

async function fixture(claims: Record<string, unknown> = {}) {
  const exp = Math.floor(Date.now() / 1000) + 600;
  const originalToken = await new SignJWT({ sub: actorId, email: "actor@example.invalid", role: "authenticated", aud: "authenticated", app_metadata: { organization_ids: [oldId], provider: "soflia" }, ...claims })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime(exp).sign(key);
  const state = { token: originalToken as string | null, member: true, role: "CONSTRUCTOR" as string | null, failMembership: false, failRole: false };
  const writes = new Map<string, { value: string; maxAge?: number }>();
  const reads: string[] = [];
  const route = load<typeof import("../../api/auth/switch-organization/route")>("src/app/api/auth/switch-organization/route.ts", {
    "next/headers": { cookies: async () => ({
      get(name: string) { assert.notEqual(name, "cf_user_orgs"); return name === "cf_access_token" && state.token ? { value: state.token } : undefined; },
      set(cookie: { name: string; value: string; maxAge?: number }) { writes.set(cookie.name, cookie); },
    }) },
    "@/lib/server/env": { getCourseforgeJwtSecret: () => secret, isProductionEnvironment: () => false },
    "@/lib/server/api-contract": contract,
    "@/lib/server/api-response": {
      apiErrorResponse: (input: { status: number }) => Response.json(input, { status: input.status }),
      apiSuccessResponse: (body: object) => Response.json(body),
    },
    "@/lib/server/operational-logger": { resolveCorrelationId: () => "solicitud-prueba", createOperationalLogger: () => ({ error() {} }) },
    "@/utils/auth/session-expiration": expiration,
    "@/utils/auth/platform-role": roles,
    "@/lib/server/tenant-memberships": { loadCurrentUserMemberships: async (id: string) => {
      assert.equal(id, actorId); reads.push("membership");
      if (state.failMembership) throw new errorModule.TenantContextLookupError();
      return state.member ? [{ id: ownId, name: "Empresa actual", slug: "empresa", role: "member", logo_url: "https://example.invalid/logo.png" }] : [];
    } },
    "@/lib/server/tenant-context": { ...errorModule, getOrganizationPlatformRole: async (id: string, org: string) => {
      assert.equal(id, actorId); assert.equal(org, ownId); reads.push("role");
      if (state.failRole) throw new errorModule.TenantContextLookupError();
      return state.role;
    } },
  });
  const call = (body: unknown = { organizationId: ownId }) => route.POST(new Request("https://example.invalid/api/auth/switch-organization", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  }) as NextRequest);
  return { state, writes, reads, call, exp };
}
describe("cambio de organización con autoridad vigente", () => {
  it("usa autoridad y DTO actual sin cookie, renueva IDs y conserva exp", async () => {
    const f = await fixture(); const response = await f.call();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).organization.name, "Empresa actual");
    const { payload } = await jwtVerify(f.writes.get("cf_access_token")!.value, key);
    assert.equal(payload.exp, f.exp); assert.equal(payload.sub, actorId);
    assert.deepEqual(payload.app_metadata, { organization_ids: [ownId], provider: "soflia", active_organization_id: ownId });
    assert.equal(f.writes.get("cf_active_org")?.value, ownId);
    assert.ok(f.writes.get("cf_access_token")!.maxAge! <= 600);
  });
  it("acepta sesión legacy sin IDs solo con autoridad vigente", async () => {
    const f = await fixture({ app_metadata: {} }); assert.equal((await f.call()).status, 200);
  });
  it("rechaza membresía revocada aunque el JWT la conserve", async () => {
    const f = await fixture({ app_metadata: { organization_ids: [ownId] } }); f.state.member = false;
    assert.equal((await f.call()).status, 403); assert.equal(f.writes.size, 0);
    assert.deepEqual(f.reads, ["membership"]);
  });
  it("rechaza rol local ausente o desconocido sin emitir token", async () => {
    for (const role of [null, "DESCONOCIDO"]) { const f = await fixture(); f.state.role = role; assert.equal((await f.call()).status, 403); assert.equal(f.writes.size, 0); }
  });
  it("autoridad caída devuelve 503 seguro sin escribir cookies", async () => {
    for (const field of ["failMembership", "failRole"] as const) {
      const f = await fixture(); f.state[field] = true; const response = await f.call();
      assert.equal(response.status, 503); assert.equal(f.writes.size, 0); assert.equal((await response.json()).retryable, true);
    }
  });
  it("sesión ausente, inválida o sin identidad no consulta autoridad", async () => {
    for (const mode of ["absent", "invalid", "identity", "expired", "no-expiration"] as const) {
      const f = await fixture(mode === "identity" ? { sub: undefined } : {});
      if (mode === "absent" || mode === "invalid") f.state.token = mode === "absent" ? null : "token-invalido";
      if (mode === "expired" || mode === "no-expiration") {
        const token = new SignJWT({ sub: actorId, email: "actor@example.invalid" }).setProtectedHeader({ alg: "HS256" });
        if (mode === "expired") token.setExpirationTime(Math.floor(Date.now() / 1000) - 60);
        f.state.token = await token.sign(key);
      }
      assert.equal((await f.call()).status, 401); assert.equal(f.reads.length, 0); assert.equal(f.writes.size, 0);
    }
  });
  it("solicitud inválida o destino ajeno no concede acceso", async () => {
    const f = await fixture(); assert.equal((await f.call({ organizationId: "invalido" })).status, 400);
    assert.equal(f.reads.length, 0);
    assert.equal((await f.call({ organizationId: oldId })).status, 403); assert.equal(f.writes.size, 0);
  });
});
