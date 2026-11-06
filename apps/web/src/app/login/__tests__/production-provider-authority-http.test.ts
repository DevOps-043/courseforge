import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";
import { load } from "./source-test-loader";

const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse: { json: Response.json } }, "./api-contract": contract });
const logger = { createOperationalLogger: () => ({ error() {}, warn() {}, info() {} }), resolveCorrelationId: () => "proveedor-test" };
const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
  "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors,
  "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
});
const outbound = load<typeof import("../../../lib/server/outbound-http")>("src/lib/server/outbound-http.ts");
const capacity = load<typeof import("../../../lib/server/external-import-concurrency")>("src/lib/server/external-import-concurrency.ts");
const externalMapper = load("src/lib/server/external-import-error.ts", {
  "./api-contract": contract, "./external-import-concurrency": capacity, "./outbound-http": outbound,
});
const componentId = "123e4567-e89b-42d3-a456-426614174000";
type AuthorityStage = "identity" | "tenant" | "component";
interface ProviderRoute {
  path: string;
  method: "GET" | "POST";
  query?: string;
  body?: Record<string, unknown>;
  stages: AuthorityStage[];
}
const artlistImport: ProviderRoute = { path: "artlist/import", method: "POST", body: { componentId, assetId: "recurso", type: "music" }, stages: ["identity", "component"] };
const routes: ProviderRoute[] = [
  { path: "artlist/search", method: "GET", query: "?type=music", stages: ["identity"] },
  { path: "cloud-storage/list", method: "GET", query: "?provider=google_drive", stages: ["identity", "tenant"] },
  { path: "google-drive/list", method: "GET", stages: ["identity", "tenant"] },
  artlistImport,
  { path: "cloud-storage/import", method: "POST", body: { componentId, provider: "google_drive", fileIdOrUrl: "archivo", type: "music" }, stages: ["identity", "tenant", "component"] },
  { path: "google-drive/import", method: "POST", body: { componentId, urlOrId: "archivo", type: "music" }, stages: ["identity", "tenant", "component"] },
  { path: "import-external", method: "POST", body: { componentId, provider: "heygen", videoId: "video" }, stages: ["identity", "component", "tenant"] },
];

function fixture(route: ProviderRoute, stage = "none", failure?: unknown, providerError?: unknown) {
  const effects = { provider: 0, constructors: 0, persistence: 0 };
  const fail = (point: string) => { if (stage === point) throw failure; };
  const forbiddenWrite = () => { effects.persistence++; throw new Error("Persistencia no permitida en esta prueba"); };
  const providerOperation = () => { effects.provider++; if (providerError) throw providerError; return []; };
  class ProviderService {
    constructor() { effects.constructors++; }
    async search() { return providerOperation(); }
    async listFiles() { return providerOperation(); }
    async refreshUserAccessToken() { return "credencial-sintetica"; }
    async importFile() { return providerOperation(); }
    async importAsset() { return providerOperation(); }
  }
  class CredentialError extends Error { constructor(message: string, readonly status: number) { super(message); } }
  class ProviderApiError extends Error { constructor(readonly status: number) { super("detalle-sensible-sintetico"); } }
  const file = `src/app/api/production/${route.path}/route.ts`;
  const imports: Record<string, unknown> = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles
    .filter(({ fileName }) => fileName.startsWith("@/")).map(({ fileName }) => [fileName, {}]));
  Object.assign(imports, {
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/authorization-unavailable-response": mapper, "@/lib/server/operational-logger": logger,
    "@/lib/server/external-import-error": externalMapper,
    "@/lib/server/external-import-concurrency": { withExternalImportCapacity: async (_provider: string, operation: () => Promise<unknown>) => operation() },
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => { fail("identity"); return stage === "missing-user" ? null : { userId: componentId }; },
      getAuthorizedMaterialComponentAdmin: async () => { fail("component"); return stage === "missing-component" ? null : { admin: { rpc: forbiddenWrite, storage: { from: forbiddenWrite } }, component: { assets: {} } }; },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => { fail("tenant"); return stage === "missing-tenant" ? null : { organizationId: componentId }; } },
    "@/domains/production/providers/artlist.service": { ArtlistService: ProviderService },
    "@/domains/production/providers/google-drive.service": { GoogleDriveService: ProviderService },
    "@/domains/production/cloud-storage/cloud-storage.service": { getCloudStorageService: () => new ProviderService() },
    "@/domains/production/cloud-storage/types": load("src/domains/production/cloud-storage/types.ts"),
    "@/domains/production/hyperframes/hyperframes-source-asset.service": { registerImportedHyperframesSourceAsset: forbiddenWrite },
    "@/domains/production/external-media-import-policy": { assertSafeExternalMediaUrl: forbiddenWrite, readResponseWithLimit: forbiddenWrite },
    "@/domains/production/providers/heygen/heygen-external-import-source": load("src/domains/production/providers/heygen/heygen-external-import-source.ts"),
    "@/domains/production/providers/heygen/heygen.client": { HeygenApiError: ProviderApiError },
    "@/domains/production/providers/heygen/heygen-credential-resolver.service": {
      HeygenCredentialResolverError: CredentialError,
      getHeygenClientForOrganization: async () => { providerOperation(); return { client: { getVideo: providerOperation } }; },
    },
  });
  const handlers = load<Record<string, (request: Request) => Promise<Response>>>(file, imports);
  return { effects, CredentialError, ProviderApiError,
    setProviderError: (error: unknown) => { providerError = error; },
    run: (request = new Request(`https://example.invalid/${route.query ?? ""}`, { method: route.method,
      ...(route.method === "POST" ? { body: JSON.stringify(route.body) } : {}) })) => handlers[route.method](request) };
}

describe("autoridad HTTP en proveedores de producción", () => {
  for (const route of routes) {
    it(`${route.method} ${route.path}: indisponibilidad no inicia efectos posteriores`, async () => {
      for (const stage of route.stages) for (const ErrorType of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
        const failure = new ErrorType(); failure.message = "detalle-sensible-sintetico";
        const f = fixture(route, stage, failure); const response = await f.run();
        assert.equal(response.status, 503, `${route.path}/${stage}`);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-request-id"), "proveedor-test");
        const body = await response.json(); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
        assert.doesNotMatch(JSON.stringify(body), /detalle-sensible/);
        assert.deepEqual(f.effects, { provider: 0, constructors: 0, persistence: 0 });
      }
    });
  }
  it("conserva ausencia de identidad, tenant y componente sin consultar al proveedor", async () => {
    for (const route of routes) for (const stage of route.stages) {
      const missing = { identity: "missing-user", tenant: "missing-tenant", component: "missing-component" }[stage];
      const f = fixture(route, missing); assert.equal((await f.run()).status, { identity: 401, tenant: 403, component: 404 }[stage]);
      assert.deepEqual(f.effects, { provider: 0, constructors: 0, persistence: 0 });
    }
  });
  it("preserva validación y límites declarados antes de autenticación", async () => {
    for (const route of routes) {
      const f = fixture(route, "identity", new Error("No debe autenticar"));
      const invalidUrl = route.path === "artlist/search" ? "?type=desconocido" : route.path === "cloud-storage/list" ? "?provider=desconocido" : `?q=${"a".repeat(201)}`;
      assert.equal((await f.run(new Request(`https://example.invalid/${invalidUrl}`, { method: route.method,
        ...(route.method === "POST" ? { body: "{}" } : {}) }))).status, 400);
      if (route.method === "POST") assert.equal((await f.run(new Request("https://example.invalid", { method: "POST", headers: { "content-length": String(100 * 1024) }, body: "{}" }))).status, 413);
      assert.deepEqual(f.effects, { provider: 0, constructors: 0, persistence: 0 });
    }
  });
  it("preserva DTO de listados y sus errores genéricos", async () => {
    for (const route of routes.filter(route => route.method === "GET")) {
      const response = await fixture(route).run(); assert.equal(response.status, 200);
      assert.deepEqual((await response.json())[route.path.startsWith("artlist") ? "results" : "files"], []);
      const failure = await fixture(route, "none", undefined, new Error("detalle-sensible-sintetico")).run();
      assert.equal(failure.status, 500); assert.doesNotMatch(await failure.text(), /detalle-sensible/);
    }
  });
  it("preserva errores externos, cuotas, timeout y Retry-After sin aceptar códigos falsos de autoridad", async () => {
    for (const [error, status, retryAfter] of [
      [new capacity.ExternalImportCapacityError("queue_full"), 503, "5"],
      [new outbound.OutboundCircuitOpenError(7), 503, "7"],
      [new DOMException("detalle-sensible-sintetico", "TimeoutError"), 504, null],
      [new Error("EXTERNAL_MEDIA_TOO_LARGE"), 413, null], [new Error("reconectar"), 409, null],
      [new Error("no encontrado"), 404, null], [new Error("detalle-sensible-sintetico"), 502, null],
      [{ code: "TENANT_LOOKUP_UNAVAILABLE" }, 502, null],
    ] as const) {
      const response = await fixture(artlistImport, "none", undefined, error).run();
      assert.equal(response.status, status); assert.equal(response.headers.get("retry-after"), retryAfter);
      assert.doesNotMatch(await response.text(), /detalle-sensible/);
    }
  });
  it("mantiene errores particulares de credenciales y API HeyGen", async () => {
    const route = routes.find(route => route.path === "import-external")!;
    for (const [kind, sourceStatus, responseStatus] of [["credential", 403, 403], ["credential", 409, 409], ["api", 429, 502]] as const) {
      const f = fixture(route);
      f.setProviderError(kind === "credential" ? new f.CredentialError("Empresa no autorizada.", sourceStatus) : new f.ProviderApiError(sourceStatus));
      const response = await f.run(); assert.equal(response.status, responseStatus);
      assert.doesNotMatch(await response.text(), /detalle-sensible/); assert.equal(f.effects.persistence, 0);
    }
  });
});
