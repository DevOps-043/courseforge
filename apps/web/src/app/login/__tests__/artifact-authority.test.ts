import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "./source-test-loader";
import type { TenantContext } from "../../../lib/server/tenant-context";

function fixture() {
  const state = {
    tenant: { userId: "actor", organizationId: "propia", organizationSlug: "empresa", organizationRole: "member", platformRole: "CONSTRUCTOR" } as TenantContext | null,
    returnedOrg: "propia" as string | null,
    lookupError: null as Error | null,
  };
  const queries: string[] = [];
  const filters: Array<[string, unknown]> = [];
  const tenantModule = {
    resolveActiveTenantContext: async () => { if (state.lookupError) throw state.lookupError; return state.tenant; },
    resolveTenantContextByOrganizationId: async (id: string) => { if (state.lookupError) throw state.lookupError; return state.tenant?.organizationId === id ? state.tenant : null; },
  };
  const auth = load<typeof import("../../../lib/server/artifact-action-auth")>("src/lib/server/artifact-action-auth.ts", {
    "@supabase/supabase-js": { createClient: () => ({ from: (table: string) => {
      queries.push(table);
      return { select() { return this; }, eq(field: string, value: unknown) { filters.push([field, value]); return this; },
        async maybeSingle() { return { data: { id: "curso", organization_id: state.returnedOrg }, error: null }; } };
    } }) },
    "next/headers": { cookies: async () => { throw new Error("La cookie no debe conceder autoridad"); } },
    "@/utils/auth/session": { getAuthBridgeUser: async () => ({ id: "actor", organization_ids: ["propia"], active_organization_id: "ajena" }), getActiveOrganizationId: async () => { throw new Error("No leer cf_active_org como fallback"); } },
    "@/lib/server/tenant-context": tenantModule,
    "@/lib/pipeline-constants": { REVIEWER_ROLE_SET: new Set(["ADMIN", "ARQUITECTO", "SUPERADMIN"]) },
    "@/lib/server/env": { getSupabaseUrl: () => "https://example.invalid", getSupabaseServiceRoleKey: () => "sintetico" },
    "./background-function-origin": { resolveBackgroundFunctionOrigin: () => "https://example.invalid" },
  });
  return { state, auth, queries, filters };
}
describe("frontera privilegiada de artefactos", () => {
  it("sin contexto ni con cookie ajena consulta artefactos", async () => {
    const f = fixture(); f.state.tenant = null;
    assert.equal(await f.auth.getAuthorizedArtifactAdmin("curso"), null);
    assert.equal(await f.auth.assertArtifactOrgAccess("curso", "ajena"), null);
    assert.equal(f.queries.length, 0);
  });
  it("ForTenant revalida contexto y no acepta un ID ajeno", async () => {
    const f = fixture();
    assert.equal(await f.auth.getAuthorizedArtifactAdminForTenant("curso", { organizationId: "ajena" }), null);
    assert.equal(f.queries.length, 0);
    assert.ok(await f.auth.getAuthorizedArtifactAdminForTenant("curso", { organizationId: "propia" }));
    assert.deepEqual(f.filters, [["id", "curso"], ["organization_id", "propia"]]);
  });
  it("acceso propio filtra un tenant y rechaza resultado ajeno o legacy null", async () => {
    const f = fixture(); assert.ok(await f.auth.getAuthorizedArtifactAdmin("curso"));
    for (const returnedOrg of ["ajena", null]) { f.state.returnedOrg = returnedOrg; assert.equal(await f.auth.getAuthorizedArtifactAdmin("curso"), null); }
  });
  it("rechaza selectores contradictorios antes de leer artefactos", async () => {
    const f = fixture(); assert.equal(await f.auth.assertArtifactOrgAccess("curso", "ajena", { organizationId: "propia" }), null);
    assert.equal(f.queries.length, 0);
  });
  it("caída de autoridad propaga el mismo error sin consulta privilegiada", async () => {
    const f = fixture(); f.state.lookupError = new Error("TENANT_LOOKUP_UNAVAILABLE");
    await assert.rejects(f.auth.getAuthorizedArtifactAdmin("curso"), error => error === f.state.lookupError);
    assert.equal(f.queries.length, 0);
  });
  it("revisión usa rol vigente y actor actual, sin perfil global ni DTO de respaldo", async () => {
    const f = fixture(); const forged = { ...f.state.tenant!, platformRole: "ADMIN" };
    assert.equal(await f.auth.canReviewContent("actor", forged), false);
    f.state.tenant!.platformRole = "ADMIN";
    assert.equal(await f.auth.canReviewContent("otro", forged), false);
    assert.equal(await f.auth.canReviewContent("actor", forged), true);
    assert.equal(await f.auth.canReviewContent("actor", null), false);
    f.state.tenant = null;
    assert.equal(await f.auth.canReviewContent("actor"), false);
    assert.equal(f.queries.length, 0);
  });
});
