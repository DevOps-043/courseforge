import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import * as schema from "../course-source.schema";
import * as policy from "../course-source-policy";
import * as errors from "../course-source-error";
import * as contract from "../../../lib/server/api-contract";
import * as responses from "../../../lib/server/api-response";
import * as mutationOrigin from "../../../lib/server/mutation-request-origin";
import { AuthIdentityLookupError } from "../../../lib/server/auth-identity-error";
import { TenantContextLookupError } from "../../../lib/server/tenant-context-error";

const course = "10000000-0000-4000-8000-000000000001";
const logger = { createOperationalLogger: () => ({ info() {}, warn() {} }), resolveCorrelationId: () => "prueba-fuentes" };
function fixture(stage: "allowed" | "anonymous" | "role" | "foreign" | "unavailable" = "allowed") {
  const effects: string[] = [];
  const tenant = { organizationId: course, userId: course, platformRole: stage === "role" ? "INVITADO" : "CONSTRUCTOR" };
  const access = load("src/domains/course-sources/course-source-access.ts", {
    "../../lib/server/tenant-context": { resolveActiveTenantContext: async () => {
      if (stage === "unavailable") throw new TenantContextLookupError();
      return stage === "anonymous" ? null : tenant;
    } },
    "../../lib/server/artifact-action-auth": {
      getServiceRoleClient: () => { effects.push("admin"); return {}; },
      getAuthorizedArtifactAdminForTenant: async (id: string, resolved: typeof tenant) => {
        assert.equal(id, course); assert.equal(resolved.organizationId, course);
        effects.push("authorize"); return stage === "foreign" ? null : { admin: {} };
      },
    },
    "./course-source-error": errors,
  });
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": { AuthIdentityLookupError }, "./tenant-context-error": { TenantContextLookupError },
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  class Repository {
    constructor() { effects.push("repository"); }
    async createDraft() { effects.push("draft"); return course; }
    async list() { effects.push("list"); return { documents: [], nextOffset: null }; }
  }
  const http = load<{ courseSourceHttp: (request: Request, operation: string, artifactId?: string) => Promise<Response> }>(
    "src/domains/course-sources/course-source-http.ts", {
      "./course-source-legacy": {},
      "../../lib/server/api-contract": contract, "../../lib/server/api-response": responses,
      "../../lib/server/authorization-unavailable-response": mapper, "../../lib/server/operational-logger": logger,
      "../../lib/server/mutation-request-origin": mutationOrigin,
      "./course-source-access": access, "./course-source-policy": policy, "./course-source-error": errors,
      "./course-source.repository": { CourseSourceRepository: Repository },
      "./course-source.service": { CourseSourceService: class { constructor() { effects.push("service"); } } },
      "./course-source-storage": { createSourceStorage: () => { effects.push("storage"); return {}; } },
      "./course-source.schema": schema,
    });
  return { effects, respond: http.courseSourceHttp };
}
const request = (body: unknown = { idempotencyKey: course, title: "Curso" }) => new Request("https://example.invalid", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("sin sesión o rol permitido no hay cliente privilegiado, repositorio ni firma", async () => {
  for (const [stage, status] of [["anonymous", 401], ["role", 403]] as const) {
    for (const operation of ["draft", "reserve", "confirm", "list"]) {
      const f = fixture(stage); const result = await f.respond(request(), operation, operation === "draft" ? undefined : course);
      assert.equal(result.status, status); assert.deepEqual(f.effects, []);
      assert.equal(result.headers.get("cache-control"), "private, no-store");
    }
  }
});

test("curso ajeno se rechaza antes de construir repositorio o Storage", async () => {
  const f = fixture("foreign"); const result = await f.respond(request(), "reserve", course);
  assert.equal(result.status, 404); assert.deepEqual(f.effects, ["authorize"]);
});

test("caída de autoridad mantiene 503 sin efectos ni detalles privados", async () => {
  const f = fixture("unavailable"); const result = await f.respond(request(), "draft");
  assert.equal(result.status, 503); assert.deepEqual(f.effects, []);
  assert.equal((await result.json()).code, "DEPENDENCY_UNAVAILABLE");
});

test("borrador devuelve DRAFT y no construye servicio de carga ni generador", async () => {
  const f = fixture(); const result = await f.respond(request(), "draft");
  assert.equal(result.status, 200);
  assert.deepEqual(f.effects, ["admin", "repository", "draft"]);
  const body = await result.json(); assert.equal(body.state, "DRAFT"); assert.equal(body.artifactId, course);
});

test("UUID inválido, autoridad enviada en payload y paginación excesiva fallan sin escritura", async () => {
  const invalidId = fixture(); assert.equal((await invalidId.respond(request(), "reserve", "falso")).status, 400);
  assert.deepEqual(invalidId.effects, []);
  const invalidBody = fixture(); assert.equal((await invalidBody.respond(request({ idempotencyKey: course, title: "Curso", organizationId: course }), "draft")).status, 400);
  assert.equal(invalidBody.effects.includes("draft"), false);
  const invalidPage = fixture(); assert.equal((await invalidPage.respond(new Request("https://example.invalid?limit=999"), "list", course)).status, 400);
  assert.equal(invalidPage.effects.includes("list"), false);
});

test("listado autorizado conserva paginación y no firma descargas", async () => {
  const f = fixture(); const result = await f.respond(new Request("https://example.invalid?limit=20&offset=0"), "list", course);
  assert.equal(result.status, 200); assert.deepEqual(f.effects, ["authorize", "repository", "list"]);
  assert.deepEqual((await result.json()).documents, []);
});

test("mutaciones rechazan formularios y origen cruzado antes de consultar autoridad", async () => {
  const cases: HeadersInit[] = [
    { "Content-Type": "text/plain" },
    { "Content-Type": "application/json", Origin: "https://otro.invalid" },
    { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    { "Content-Type": "application/json", Origin: "https://example.invalid", "Sec-Fetch-Site": "same-site" },
    { "Content-Type": "application/json", Origin: "null", "Sec-Fetch-Site": "same-origin" },
    { "Content-Type": "application/json", Origin: "https://otro.invalid", "X-Forwarded-Host": "otro.invalid" },
  ];
  for (const headers of cases) {
    const f = fixture(); const result = await f.respond(new Request("https://example.invalid", {
      method: "POST", headers, body: JSON.stringify({ idempotencyKey: course, title: "Curso" }),
    }), "draft");
    assert.ok([403, 415].includes(result.status)); assert.deepEqual(f.effects, []);
    if (result.status === 403) assert.equal((await result.json()).code, "ORIGIN_FORBIDDEN");
  }
});

test("un navegador del mismo origen llega a autorización cuando el proxy reconstruye la URL", async () => {
  for (const [stage, status] of [["allowed", 200], ["anonymous", 401], ["role", 403]] as const) {
    const f = fixture(stage);
    const result = await f.respond(new Request("http://localhost:3000/api/artifacts/drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://staging.example.invalid", "Sec-Fetch-Site": "same-origin" },
      body: JSON.stringify({ idempotencyKey: course, title: "Curso" }),
    }), "draft");
    assert.equal(result.status, status);
    assert.deepEqual(f.effects, stage === "allowed" ? ["admin", "repository", "draft"] : []);
    if (stage === "role") assert.equal((await result.json()).code, "ROLE_FORBIDDEN");
  }
});
