import assert from "node:assert/strict";
import { test } from "node:test";
import { NextResponse } from "next/server";
import { load } from "./source-test-loader";

const identity = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
const tenant = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
type Action = typeof import("../../../domains/production/slides/slide-template-library.actions");
type Route = typeof import("../../api/production/slides/templates/route");

function fixture(options: { failure?: unknown; identityFailure?: unknown; organizationId?: string | null; anonymous?: boolean; databaseFailure?: unknown; populated?: boolean } = {}) {
  const effects = { admin: 0, authority: 0, legacy: 0, filters: [] as Array<[string, string, unknown]>, logs: [] as unknown[] };
  const logger = { createOperationalLogger: () => ({
    error: (...args: unknown[]) => effects.logs.push(args.map(value => value instanceof Error ? { name: value.name, message: value.message } : value)),
    warn: (...args: unknown[]) => effects.logs.push(args),
  }), resolveCorrelationId: () => "biblioteca-autoridad-test" };
  const rows: Record<string, unknown[]> = options.populated ? {
    soflia_bundle_generation_runs: [{ id: "run", conversation_id: "conversation", spec_id: "spec", organization_id: "vigente", status: "PACKAGED", created_at: "2026-11-05" }],
    soflia_bundle_conversations: [{ id: "conversation", title: "Conversación" }],
    soflia_bundle_specs: [{ id: "spec", spec_json: { artifactKind: "slide_template", title: "Plantilla vigente", examples: [{ slides: [{ title: "Inicio" }] }] } }],
  } : {};
  const action = load<Action>("src/domains/production/slides/slide-template-library.actions.ts", {
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => { if (options.identityFailure) throw options.identityFailure; return options.anonymous ? null : { id: "actor" }; },
      getServiceRoleClient: () => { effects.admin++; return { from: (table: string) => {
        const result = { data: rows[table] || [], error: options.databaseFailure || null };
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => { effects.filters.push([table, column, value]); return query; },
          is: () => query, order: () => query, limit: async () => result, in: async () => result,
        };
        return query;
      } }; },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => {
      effects.authority++;
      if (options.failure) throw options.failure;
      return options.organizationId === null ? null : { organizationId: options.organizationId || "vigente" };
    } },
    // Claims/cookies hostiles: nunca deben conceder autoridad ni consultarse.
    "@/utils/auth/session": {
      getAuthBridgeUser: async () => { effects.legacy++; return { active_organization_id: "ajena", organization_ids: ["ajena"] }; },
      getUserOrganizations: async () => { effects.legacy++; return [{ id: "ajena" }]; },
    },
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "./import/imported-slide-design.service": { importedDesignPreview: () => { throw new Error("Preview no esperado"); } },
    "./import/imported-slide-design.contract": { importedSlideDesignSchema: { safeParse: () => ({ success: false }) } },
    "@/lib/server/auth-identity-error": identity, "@/lib/server/tenant-context-error": tenant,
    "@/lib/server/api-contract": contract, "@/lib/server/operational-logger": logger,
  });
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": identity, "./tenant-context-error": tenant,
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  const route = load<Route>("src/app/api/production/slides/templates/route.ts", {
    "@/domains/production/slides/slide-template-library.actions": action,
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "@/lib/server/authorization-unavailable-response": mapper,
  });
  return { effects, action: action.getSlideTemplatePackagesAction, get: () => route.GET(new Request("https://local.test/api/production/slides/templates")) };
}

test("la biblioteca usa solo organización vigente en las tres consultas y conserva el DTO", async () => {
  const context = fixture({ populated: true });
  const response = await context.get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.slideTemplates[0].title, "Plantilla vigente");
  assert.equal(body.slideTemplates[0].organization_id, "vigente");
  assert.equal(body.slideTemplates[0].preview_slides[0].title, "Inicio");
  assert.equal(context.effects.authority, 1);
  assert.equal(context.effects.legacy, 0);
  assert.equal(context.effects.filters.length, 3);
  for (const [, column, value] of context.effects.filters) { assert.equal(column, "organization_id"); assert.equal(value, "vigente"); }
});

test("tenant vigente sin plantillas conserva éxito vacío", async () => {
  const context = fixture();
  const result = await context.action();
  assert.equal(result.success, true);
  assert.equal(result.slideTemplates?.length, 0);
  assert.equal(context.effects.admin, 1);
});

test("membresía ausente devuelve fallo serializable y 403 sin cliente privilegiado", async () => {
  const context = fixture({ organizationId: null });
  const result = await context.action();
  assert.equal(result.success, false);
  assert.equal(JSON.parse(JSON.stringify(result)).errorCode, "TENANT_FORBIDDEN");
  assert.equal((await context.get()).status, 403);
  assert.equal(context.effects.admin, 0);
  assert.equal(context.effects.legacy, 0);
});

for (const [name, Failure] of [["identidad", identity.AuthIdentityLookupError], ["tenant", tenant.TenantContextLookupError]] as const) {
  for (const stage of ["identityFailure", "failure"] as const) {
    test(`${name} no disponible en ${stage}: 503 seguro antes de acceso privilegiado`, async () => {
      const context = fixture({ [stage]: Object.assign(new Failure(), { message: "CANARIO_PRIVADO" }) });
      const result = await context.action();
      assert.equal(result.success, false);
      assert.equal(JSON.parse(JSON.stringify(result)).errorCode, "DEPENDENCY_UNAVAILABLE");
      const response = await context.get();
      const body = await response.json();
      assert.equal(response.status, 503);
      assert.equal(body.code, "DEPENDENCY_UNAVAILABLE");
      assert.equal(body.retryable, true);
      assert.equal(body.requestId, "biblioteca-autoridad-test");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("vary") || "", /Cookie/);
      assert.equal(context.effects.admin, 0);
      assert.equal(context.effects.legacy, 0);
      assert.doesNotMatch(JSON.stringify([result, body, context.effects.logs]), /CANARIO_PRIVADO/);
    });
  }
}

test("sesión ausente conserva Unauthorized y HTTP 401", async () => {
  const context = fixture({ anonymous: true });
  assert.equal((await context.action()).error, "Unauthorized");
  assert.equal((await context.get()).status, 401);
  assert.equal(context.effects.authority, 0);
  assert.equal(context.effects.admin, 0);
});

for (const failure of [new Error("CANARIO_PRIVADO"), { message: "CANARIO_PRIVADO", code: "42P01" }, Object.assign(new Error("CANARIO_PRIVADO"), { name: "TenantContextLookupError", code: "TENANT_LOOKUP_UNAVAILABLE" })]) {
  test("error inesperado no expone internals ni se convierte en fallo de autoridad", async () => {
    const context = fixture({ databaseFailure: failure });
    const result = await context.action();
    const response = await context.get();
    assert.equal(result.success, false);
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify([result, await response.json(), context.effects.logs]), /CANARIO_PRIVADO/);
  });
}
