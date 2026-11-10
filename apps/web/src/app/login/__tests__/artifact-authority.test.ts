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
    "./server-identity": {},
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

describe("eliminación de artefactos", () => {
  const artifactId = "40000000-0000-4000-8000-000000000001";
  const organizationId = "50000000-0000-4000-8000-000000000001";

  function deletionFixture() {
    const state = { platformRole: "ADMIN", tenantAvailable: true, outcome: "DELETED", databaseError: null as null | { code: string; message: string } };
    const calls: Array<[string, Record<string, string>]> = [];
    let privilegedClients = 0;
    class AuthorityUnavailable extends Error {}
    const action = load<typeof import("../../../domains/artifacts/actions/delete-artifact.action")>(
      "src/domains/artifacts/actions/delete-artifact.action.ts",
      {
        "@/lib/pipeline-constants": { REVIEWER_ROLE_SET: new Set(["ADMIN", "ARQUITECTO", "SUPERADMIN"]) },
        "@/lib/server/tenant-context": {
          TenantContextLookupError: AuthorityUnavailable,
          resolveActiveTenantContext: async () => {
            if (!state.tenantAvailable) throw new AuthorityUnavailable();
            return { organizationId, platformRole: state.platformRole };
          },
        },
        "@/lib/server/auth-identity-error": { AuthIdentityLookupError: AuthorityUnavailable },
        "@/lib/server/operational-logger": { resolveCorrelationId: () => "referencia", createOperationalLogger: () => ({ warn() {} }) },
        "@/lib/server/artifact-action-auth": { getServiceRoleClient: () => {
          privilegedClients++;
          return { rpc: async (name: string, parameters: Record<string, string>) => {
            calls.push([name, { ...parameters }]);
            return { data: state.outcome, error: state.databaseError };
          } };
        } },
      },
    );
    return { state, action, calls, privilegedClients: () => privilegedClients };
  }

  it("rechaza UUID inválido, rol sin permiso y autoridad caída antes de construir el cliente privilegiado", async () => {
    const f = deletionFixture();
    assert.equal((await f.action.deleteArtifactAction("inválido")).success, false);
    f.state.platformRole = "CONSTRUCTOR";
    assert.equal((await f.action.deleteArtifactAction(artifactId)).success, false);
    f.state.tenantAvailable = false;
    assert.equal((await f.action.deleteArtifactAction(artifactId)).success, false);
    assert.equal(f.privilegedClients(), 0);
  });

  it("envía la organización resuelta en servidor y solo confirma la respuesta DELETED", async () => {
    const f = deletionFixture();
    assert.equal((await f.action.deleteArtifactAction(artifactId)).success, true);
    assert.deepEqual(f.calls, [["delete_artifact_for_organization", {
      p_artifact_id: artifactId, p_organization_id: organizationId,
    }]]);
    for (const outcome of ["NOT_FOUND", "HAS_SOURCE_DOCUMENTS", "DESCONOCIDO"]) {
      f.state.outcome = outcome;
      assert.equal((await f.action.deleteArtifactAction(artifactId)).success, false);
    }
  });

  it("presenta un bloqueo sin exponer el detalle de PostgreSQL", async () => {
    const f = deletionFixture();
    f.state.databaseError = { code: "23503", message: "Detalle SQL interno" };
    const result = await f.action.deleteArtifactAction(artifactId);
    assert.ok(!result.success);
    assert.match(result.error, /datos vinculados.*referencia/i);
    assert.doesNotMatch(result.error, /Detalle SQL interno/);
  });
});
