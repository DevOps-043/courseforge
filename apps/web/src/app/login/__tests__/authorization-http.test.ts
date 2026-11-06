import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "./source-test-loader";

const authErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load<typeof import("../../../lib/server/api-contract")>("src/lib/server/api-contract.ts");
const responses = load<typeof import("../../../lib/server/api-response")>("src/lib/server/api-response.ts", {
  "next/server": { NextResponse: { json: Response.json } }, "./api-contract": contract,
});
const warnings: string[] = [];
const unavailable = load<typeof import("../../../lib/server/authorization-unavailable-response")>("src/lib/server/authorization-unavailable-response.ts", {
  "./auth-identity-error": authErrors, "./tenant-context-error": tenantErrors,
  "./api-contract": contract, "./api-response": responses,
  "./operational-logger": { createOperationalLogger: (component: string, context: unknown) => ({
    warn: (event: string, fields: unknown) => warnings.push(JSON.stringify({ component, context, event, fields })),
  }) },
});
const schemas = load<typeof import("../../../domains/publication/publication.schemas")>("src/domains/publication/publication.schemas.ts");
const id = "123e4567-e89b-42d3-a456-426614174000";
const draft = { category: "categoria", level: "beginner", instructor_email: "actor@example.invalid", slug: "curso", price: 0, lesson_videos: {}, status: "DRAFT" };
const routes = [
  { name: "save-draft", file: "src/app/api/save-draft/route.ts", body: { artifactId: id, data: draft } },
  { name: "publish", file: "src/app/api/publish/route.ts", body: { artifactId: id } },
  { name: "admin/users", file: "src/app/api/admin/users/route.ts", body: { id, email: "actor@example.invalid", role: "ADMIN" } },
];
function fixture(file: string, failureAt: string, failure: unknown) {
  let effects = 0;
  let errorLogs = 0;
  const fail = (stage: string) => { if (stage === failureAt) throw failure; };
  const forbiddenEffect = () => { effects++; throw new Error("Efecto inesperado después de denegar acceso"); };
  const route = load<{ POST(request: Request): Promise<Response> }>(file, {
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@supabase/supabase-js": { createClient: forbiddenEffect },
    "next/cache": { revalidatePath: forbiddenEffect },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => { fail("identity"); return { userId: id }; },
      getServiceRoleClient: () => ({ from: forbiddenEffect }),
      getAuthorizedArtifactAdminForTenant: async () => { fail("artifact"); return { artifact: { id }, admin: {} }; },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => { fail("tenant"); return { organizationId: id, userId: id, platformRole: "ADMIN" }; } },
    "@/lib/server/authorization-unavailable-response": unavailable,
    "@/lib/server/api-contract": contract,
    "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": { resolveCorrelationId: () => "request-prueba", createOperationalLogger: () => ({ error() { errorLogs++; }, warn() {} }) },
    "@/lib/server/env": { getSofliaInboxEnv: forbiddenEffect },
    "@/domains/publication/publication.schemas": schemas,
    "@/app/admin/artifacts/[id]/publish/actions": { getPublicationData: forbiddenEffect },
    "@/domains/publication/lib/publication-payload": { buildPublicationPayload: forbiddenEffect },
    "@/domains/publication/publication-outbox": {},
    "@/lib/server/background-function-client": { dispatchBackgroundFunctionJson: forbiddenEffect },
    "@/domains/course-delivery/services/delivery-publication": { assertDeliveryPublicationReady: forbiddenEffect },
  });
  return { route, effects: () => effects, errorLogs: () => errorLogs };
}
describe("errores HTTP de autoridad en publicación y usuarios", () => {
  for (const route of routes) {
    it(`${route.name}: identidad y tenant caídos producen 503 sin efectos`, async () => {
      for (const stage of route.name === "admin/users" ? ["identity", "tenant"] : ["identity", "tenant", "artifact"]) {
        for (const ErrorType of [authErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
          const error = new ErrorType(); error.message = "detalle-sensible-sintetico";
          const f = fixture(route.file, stage, error);
          const response = await f.route.POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify(route.body) }));
          assert.equal(response.status, 503); assert.equal(response.headers.get("cache-control"), "private, no-store");
          assert.equal(response.headers.get("vary"), "Cookie"); assert.equal(response.headers.get("x-request-id"), "request-prueba");
          const body = await response.json();
          assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
          assert.equal(body.requestId, "request-prueba"); assert.equal(body.correlationId, body.requestId);
          assert.doesNotMatch(JSON.stringify(body), /detalle-sensible/);
          assert.equal(f.effects(), 0); assert.equal(f.errorLogs(), 0);
          assert.match(warnings.at(-1)!, /autorizacion.no_disponible/);
          assert.match(warnings.at(-1)!, /request-prueba/);
          assert.doesNotMatch(warnings.at(-1)!, /detalle-sensible/);
        }
      }
    });
    it(`${route.name}: conserva 400 de validación y 500 para errores ajenos`, async () => {
      const f = fixture(route.file, "identity", new Error("error-generico"));
      const response = await f.route.POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify(route.body) }));
      assert.equal(response.status, 500); assert.equal(f.effects(), 0);
      const validIdentity = fixture(route.file, "none", null);
      const invalid = await validIdentity.route.POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ inesperado: true }) }));
      assert.equal(invalid.status, 400); assert.equal(validIdentity.effects(), 0);
    });
  }
  it("no trata un objeto con code o un error genérico como clase de autoridad", () => {
    assert.equal(unavailable.authorizationUnavailableResponse({ code: "AUTH_LOOKUP_UNAVAILABLE" }, "request-prueba"), null);
    assert.equal(unavailable.authorizationUnavailableResponse(new Error("TENANT_LOOKUP_UNAVAILABLE"), "request-prueba"), null);
  });
});
