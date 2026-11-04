import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "./source-test-loader";

const ownId = "123e4567-e89b-42d3-a456-426614174000";
const foreignId = "123e4567-e89b-42d3-a456-426614174001";
const errorModule = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const roleModule = load<typeof import("../../../utils/auth/platform-role")>("src/utils/auth/platform-role.ts");
const retry = { runTenantLookupWithRetry: async (lookup: (signal: AbortSignal) => Promise<unknown>) => lookup(new AbortController().signal), isTransientTenantLookupError: () => false };
function fixture() {
  const state = {
    user: { id: "usuario-prueba", platform_role: "ADMIN", organization_ids: [ownId] } as { id: string; platform_role: string; organization_ids?: string[] } | null,
    rows: [{ organization_id: ownId, role: "member", organizations: { id: ownId, name: "Empresa", slug: "empresa" } }] as unknown,
    count: 1 as number | null,
    membershipError: null as unknown,
    roleError: null as unknown,
    storedRole: "CONSTRUCTOR" as string | null,
    activeCookie: foreignId as string | null,
    referer: "https://example.invalid/empresa/admin",
  };
  const filters: Array<[string, unknown]> = [];
  let roleReads = 0;
  const memberships = load<typeof import("../../../lib/server/tenant-memberships")>("src/lib/server/tenant-memberships.ts", {
    "@supabase/supabase-js": { createClient: () => ({ from: (table: string) => {
      assert.equal(table, "organization_users");
      return {
        select(fields: string, options: unknown) { assert.match(fields, /organizations!inner/); assert.equal(JSON.stringify(options), JSON.stringify({ count: "exact" })); return this; },
        eq(field: string, value: unknown) { filters.push([field, value]); return this; },
        limit(maximum: number) { assert.equal(maximum, 1000); return this; },
        async abortSignal(signal: AbortSignal) { assert.ok(signal); return { data: state.rows, count: state.count, error: state.membershipError }; },
      };
    } }) },
    "./env": { getSofliaInboxEnv: () => ({ url: "https://example.invalid", key: "sintetico" }) },
    "./tenant-lookup-retry": retry,
    "./tenant-context-error": errorModule,
  });
  const tenant = load<typeof import("../../../lib/server/tenant-context")>("src/lib/server/tenant-context.ts", {
    "@supabase/supabase-js": { createClient: () => ({ from: (table: string) => {
      assert.equal(table, "organization_user_roles"); roleReads++;
      return { select() { return this; }, eq(field: string, value: unknown) { assert.ok(field === "user_id" ? value === "usuario-prueba" : value === ownId); return this; },
        abortSignal() { return this; }, async maybeSingle() { return { data: state.storedRole ? { platform_role: state.storedRole } : null, error: state.roleError }; } };
    } }) },
    react: { cache: <T>(fn: T) => fn },
    "next/headers": { cookies: async () => ({ get: () => state.activeCookie ? ({ value: state.activeCookie }) : undefined }), headers: async () => new Map([["referer", state.referer]]) },
    "@/utils/auth/session": { getAuthBridgeUser: async () => state.user, getUserOrganizations: async () => { throw new Error("No debe leer cookies de organizaciones"); } },
    "@/lib/server/env": { getSupabaseUrl: () => "https://example.invalid", getSupabaseServiceRoleKey: () => "sintetico" },
    "@/utils/auth/platform-role": roleModule,
    "@/lib/server/tenant-lookup-retry": retry,
    "./tenant-memberships": memberships,
    "./tenant-context-error": errorModule,
  });
  return { state, tenant, memberships, filters, roleReads: () => roleReads };
}
describe("autoridad tenant vigente", () => {
  it("conserva rol local e ignora cookie y rol global ADMIN", async () => {
    const f = fixture();
    assert.equal((await f.tenant.resolveTenantContext("empresa"))?.platformRole, "CONSTRUCTOR");
    assert.deepEqual(f.filters, [["user_id", "usuario-prueba"], ["status", "active"]]);
    assert.equal(await f.tenant.resolveDefaultTenantPath(), "/empresa/admin");
  });
  it("deniega rol ausente o desconocido sin fallback", async () => {
    for (const role of [null, "DESCONOCIDO"]) { const f = fixture(); f.state.storedRole = role; assert.equal(await f.tenant.resolveTenantContext("empresa"), null); }
  });
  it("claims vacíos o ausentes no agregan membresía desde cookie", async () => {
    for (const ids of [[], undefined]) {
      const f = fixture(); f.state.user!.organization_ids = ids; f.state.rows = []; f.state.count = 0;
      assert.equal(await f.tenant.resolveTenantContext("empresa"), null); assert.equal(f.roleReads(), 0);
    }
  });
  it("recupera sesión legacy con membresía vigente sin depender de cookie", async () => {
    const f = fixture(); f.state.user!.organization_ids = []; f.state.activeCookie = null;
    assert.equal((await f.tenant.resolveTenantContext("empresa"))?.organizationId, ownId);
  });
  it("revocación prevalece sobre claim firmado y rol local", async () => {
    const f = fixture(); f.state.rows = []; f.state.count = 0;
    assert.equal(await f.tenant.resolveTenantContext("empresa"), null); assert.equal(f.roleReads(), 0);
  });
  it("resuelve por ID solo membresía vigente y rol local", async () => {
    const f = fixture();
    assert.equal(await f.tenant.resolveTenantContextByOrganizationId(foreignId), null);
    assert.equal(f.roleReads(), 0);
    assert.equal((await f.tenant.resolveTenantContextByOrganizationId(ownId))?.platformRole, "CONSTRUCTOR");
    f.state.storedRole = null;
    assert.equal(await f.tenant.resolveTenantContextByOrganizationId(ownId), null);
    f.state.storedRole = "CONSTRUCTOR";
    f.state.rows = [
      { organization_id: ownId, role: "member", organizations: { id: ownId, name: "Empresa", slug: "empresa" } },
      { organization_id: foreignId, role: "member", organizations: { id: foreignId, name: "Duplicada", slug: "empresa" } },
    ];
    f.state.count = 2;
    assert.equal(await f.tenant.resolveTenantContextByOrganizationId(foreignId), null);
  });
  it("no consulta roles para slug ajeno ni membresías sin identidad", async () => {
    const f = fixture(); assert.equal(await f.tenant.resolveTenantContext("ajena"), null); assert.equal(f.roleReads(), 0);
    f.state.user = null; const previousQueries = f.filters.length;
    assert.equal(await f.tenant.resolveTenantContext("empresa"), null); assert.equal(f.filters.length, previousQueries);
  });
  it("propaga caída de membresía y rol incluso con referer", async () => {
    for (const field of ["membershipError", "roleError"] as const) {
      const f = fixture(); f.state[field] = { message: "Fallo sintético" };
      await assert.rejects(f.tenant.resolveActiveTenantContext(), error => error instanceof errorModule.TenantContextLookupError);
    }
  });
  it("rechaza resultados truncados, malformados o inconsistentes", async () => {
    for (const rows of [null, {}, [{ organization_id: foreignId, role: "owner", organizations: { id: ownId, name: "Empresa", slug: "empresa" } }]]) {
      const f = fixture(); f.state.rows = rows;
      await assert.rejects(f.memberships.loadCurrentUserMemberships("usuario-prueba"), error => error instanceof errorModule.TenantContextLookupError);
    }
    for (const count of [null, 2, 1001]) {
      const f = fixture(); f.state.count = count;
      await assert.rejects(f.memberships.loadCurrentUserMemberships("usuario-prueba"), error => error instanceof errorModule.TenantContextLookupError);
    }
  });
});
