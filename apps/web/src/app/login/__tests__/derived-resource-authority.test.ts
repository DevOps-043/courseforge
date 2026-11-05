import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "./source-test-loader";
import type { TenantContext } from "../../../lib/server/tenant-context";

function fixture() {
  const state = {
    tenant: { userId: "actor", organizationId: "propia", organizationSlug: "empresa", organizationRole: "member", platformRole: "CONSTRUCTOR" } as TenantContext | null,
    error: false, absent: false, foreign: false, arrays: false, unavailable: false, missingRelation: false,
  };
  const reads: string[] = [];
  const paths: Record<string, string> = {
    curation_rows: "curation.artifacts.organization_id",
    material_components: "material_lessons.materials.artifacts.organization_id",
    materials: "artifacts.organization_id",
    material_lessons: "materials.artifacts.organization_id",
    artifacts: "organization_id",
  };
  const relation = <T>(value: T): T | T[] => state.arrays ? [value] : value;
  const client = { from: (table: string) => {
    reads.push(table);
    const filters = new Map<string, unknown>();
    let fields = "";
    return {
      select(selected: string) { fields = selected; return this; },
      eq(field: string, value: unknown) { filters.set(field, value); return this; },
      async maybeSingle() {
        assert.equal(filters.get(paths[table]), "propia", `Consulta sin scope: ${table}`);
        assert.ok(filters.has("id"));
        if (table !== "artifacts") assert.match(fields, /artifacts!inner/);
        if (state.error) return { data: null, error: { message: "fallo-sintetico" } };
        if (state.absent || state.foreign) return { data: null, error: null };
        if (state.missingRelation) return { data: { id: "sin-relacion" }, error: null };
        const materials = { artifact_id: "curso" };
        const data = table === "artifacts" ? { id: "curso", organization_id: "propia" }
          : table === "curation_rows" ? { id: "fila", curation_id: "curacion", curation: relation(materials) }
          : table === "material_components" ? { id: "componente", material_lessons: relation({ materials: relation(materials) }) }
          : table === "materials" ? { id: "material", artifact_id: "curso", state: "READY", version: 1 }
          : { id: "leccion", materials_id: "material", materials: relation(materials) };
        return { data, error: null };
      },
    };
  } };
  const tenant = {
    resolveActiveTenantContext: async () => { if (state.unavailable) throw new Error("TENANT_LOOKUP_UNAVAILABLE"); return state.tenant; },
    resolveTenantContextByOrganizationId: async (id: string) => { if (state.unavailable) throw new Error("TENANT_LOOKUP_UNAVAILABLE"); return id === state.tenant?.organizationId ? state.tenant : null; },
  };
  const auth = load<typeof import("../../../lib/server/artifact-action-auth")>("src/lib/server/artifact-action-auth.ts", {
    "./server-identity": {},
    "@supabase/supabase-js": { createClient: () => client },
    "next/headers": {}, "@/utils/auth/session": {},
    "@/lib/server/tenant-context": tenant,
    "@/lib/pipeline-constants": { REVIEWER_ROLE_SET: new Set(["ADMIN"]) },
    "@/lib/server/env": { getSupabaseUrl: () => "https://example.invalid", getSupabaseServiceRoleKey: () => "sintetico" },
    "./background-function-origin": {},
  });
  const materials = load<typeof import("../../../domains/materials/actions/materials-action-helpers")>("src/domains/materials/actions/materials-action-helpers.ts", {
    "@/lib/server/artifact-action-auth": auth, "@/lib/server/tenant-context": tenant,
    "@/lib/server/background-function-client": {}, "@/lib/pipeline-generation-policy": {},
    "../services/materials-generation-recovery": {},
  });
  const calls = [
    () => auth.getAuthorizedCurationRowAdmin("fila"),
    () => auth.getAuthorizedMaterialComponentAdmin("componente"),
    () => auth.getAuthorizedMaterialComponentAdminForTenant("componente", "propia"),
    () => materials.getAuthorizedMaterialsAdmin("material"),
    () => materials.getAuthorizedMaterialLessonAdmin("leccion"),
  ];
  return { state, auth, calls, reads };
}
describe("acceso tenant a recursos derivados", () => {
  it("sin contexto no realiza prelecturas privilegiadas", async () => {
    const f = fixture(); f.state.tenant = null;
    for (const call of f.calls) assert.equal(await call(), null);
    assert.equal(f.reads.length, 0);
  });
  it("revalida ForTenant ajeno antes de consultar", async () => {
    const f = fixture(); assert.equal(await f.auth.getAuthorizedMaterialComponentAdminForTenant("componente", "ajena"), null);
    assert.equal(f.reads.length, 0);
  });
  it("resuelve recursos propios con filtro tenant y relación objeto o arreglo", async () => {
    for (const arrays of [false, true]) {
      const f = fixture(); f.state.arrays = arrays;
      for (const call of f.calls) { const result = await call(); assert.ok(result); assert.equal(result.artifactId, "curso"); }
    }
  });
  it("ausencia o recurso ajeno no pasa a la segunda lectura de artefacto", async () => {
    for (const mode of ["absent", "foreign"] as const) {
      const f = fixture(); f.state[mode] = true;
      for (const call of f.calls) assert.equal(await call(), null);
      assert.ok(!f.reads.includes("artifacts"));
    }
  });
  it("mantiene semántica de errores por helper sin conceder acceso", async () => {
    const f = fixture(); f.state.error = true;
    assert.equal(await f.calls[0](), null);
    await assert.rejects(f.calls[1](), error => error instanceof f.auth.MaterialComponentLookupUnavailableError);
    for (const call of f.calls.slice(2)) assert.equal(await call(), null);
    assert.ok(!f.reads.includes("artifacts"));
  });
  it("no autoriza ni busca artefactos cuando falta la relación requerida", async () => {
    const f = fixture(); f.state.missingRelation = true;
    for (const call of f.calls) assert.equal(await call(), null);
    assert.ok(!f.reads.includes("artifacts"));
  });
  it("autoridad caída se propaga antes de cualquier prelectura", async () => {
    const f = fixture(); f.state.unavailable = true;
    for (const call of f.calls) await assert.rejects(call(), /TENANT_LOOKUP_UNAVAILABLE/);
    assert.equal(f.reads.length, 0);
  });
});
