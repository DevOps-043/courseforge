import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { load } from "./source-test-loader";

const authErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load<typeof import("../../../lib/server/api-contract")>("src/lib/server/api-contract.ts");
const responses = load<typeof import("../../../lib/server/api-response")>("src/lib/server/api-response.ts", { "next/server": { NextResponse: { json: Response.json } }, "./api-contract": contract });
const logger = { createOperationalLogger: () => ({ warn() {}, error() {}, info() {} }), resolveCorrelationId: () => "solicitud-test" };
const mapper = load("src/lib/server/authorization-unavailable-response.ts", { "./auth-identity-error": authErrors, "./tenant-context-error": tenantErrors, "./api-contract": contract, "./api-response": responses, "./operational-logger": logger });
const documents = load<typeof import("../../../domains/syllabus/syllabus-source-documents")>("src/domains/syllabus/syllabus-source-documents.ts");
const generation = load("src/domains/syllabus/syllabus-generation-request.schema.ts", { "./syllabus-source-documents": documents });
const management = load("src/domains/syllabus/syllabus-management-request.schema.ts");
const importSchema = load("src/domains/syllabus/import/syllabus-import.schema.ts");
class ImportError extends Error { constructor(message: string, readonly status: number) { super(message); } }
const id = "123e4567-e89b-42d3-a456-426614174000";
const routes = [
  ...["GET", "DELETE", "PATCH", "POST"].map(method => ({ file: "src/app/api/syllabus/route.ts", method,
    body: method === "PATCH" ? { artifactId: id, action: "status", state: "STEP_DRAFT" } : { artifactId: id, ideaCentral: "Idea", objetivos: ["Objetivo"], route: "B_NO_SOURCE" } })),
  { file: "src/app/api/syllabus/prompt/route.ts", method: "GET", body: {} },
  { file: "src/app/api/syllabus/documents/route.ts", method: "POST", body: {} },
  ...["GET", "POST"].map(method => ({ file: "src/app/api/syllabus/imports/route.ts", method, body: { action: "start", artifactId: id, primaryDocumentId: id, supportDocumentIds: [], idempotencyKey: id } })),
  { file: "src/app/api/storage/signed-upload-url/route.ts", method: "POST", body: { bucket: "thumbnails", purpose: "thumbnail", filePath: "imagen.png" } },
];
function fixture(file: string, stage: string, failure: unknown) {
  let effects = 0;
  const downstream = () => { effects++; throw new Error("Efecto posterior no permitido"); };
  const fail = (point: string) => { if (stage === point) throw failure; };
  const tenant = { organizationId: id, userId: id, platformRole: "ADMIN" };
  const auth = {
    getAuthenticatedUser: async () => { fail("identity"); return { userId: id }; },
    getAuthorizedArtifactAdminForTenant: async () => { fail("artifact"); return { admin: { from: downstream }, artifact: { id } }; },
    getServiceRoleClient: downstream, canReviewContent: downstream,
  };
  const tenantModule = { resolveActiveTenantContext: async () => { fail("tenant"); return stage === "missing-tenant" ? null : tenant; } };
  const repository = { SyllabusImportError: ImportError, isSyllabusImportEnabled: () => true, SyllabusImportRepository: downstream };
  const importAuth = load("src/domains/syllabus/import/syllabus-import.http.ts", {
    "../../../utils/supabase/server": { createClient: async () => ({}) }, "../../../lib/server/artifact-action-auth": auth,
    "../../../lib/server/tenant-context": tenantModule, "./syllabus-import.repository": repository,
  });
  // Solo dependencias posteriores a autorización se sustituyen; schemas y gate son reales.
  const dependencies: Record<string, unknown> = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles
    .filter(({ fileName }) => fileName.startsWith("@/") || fileName === "openai" || fileName === "@google/genai")
    .map(({ fileName }) => [fileName, {}]));
  Object.assign(dependencies, {
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses, "@/lib/server/authorization-unavailable-response": mapper,
    "@/lib/server/operational-logger": logger, "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/artifact-action-auth": auth, "@/lib/server/tenant-context": tenantModule,
    "@/utils/auth/session": { getActiveOrganizationId: downstream, getAuthBridgeUser: downstream, getUserOrganizations: downstream },
    "@/domains/syllabus/syllabus-generation-request.schema": generation, "@/domains/syllabus/syllabus-management-request.schema": management,
    "@/domains/syllabus/syllabus-source-documents": documents, "@/domains/syllabus/import/syllabus-import.schema": importSchema,
    "@/domains/syllabus/import/syllabus-import.http": importAuth, "@/domains/syllabus/import/syllabus-import.repository": repository,
    "@/domains/syllabus/lib/syllabus-document-extractor": { extractSyllabusSourceDocument: downstream },
    "@/shared/config/prompts/prompt-resolver.service": { resolvePromptWithMetadata: downstream },
    "@/lib/server/background-function-client": { dispatchBackgroundFunctionJson: downstream },
    "@/domains/production/media-storage.config": { HYPERFRAMES_PRIVATE_SOURCE_BUCKET: "fuentes-privadas" },
  });
  const handlers = load<Record<string, (request: Request) => Promise<Response>>>(file, dependencies);
  return { handlers, effects: () => effects };
}
function request(route: typeof routes[number]) {
  const form = new FormData(); form.set("artifactId", id);
  return new Request(`https://example.invalid?artifactId=${id}`, { method: route.method,
    ...(route.method === "GET" || route.method === "DELETE" ? {} : { body: route.file.includes("documents") ? form : JSON.stringify(route.body) }) });
}
describe("autoridad HTTP de syllabus, documentos e upload", () => {
  for (const route of routes) {
    it(`${route.method} ${route.file}: caída de autoridad no inicia efectos`, async () => {
      const stages = route.file.includes("storage") ? ["identity", "tenant"] : ["identity", "tenant", "artifact"];
      for (const stage of stages) for (const ErrorType of [authErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
        const error = new ErrorType(); error.message = "detalle-sensible-sintetico";
        const f = fixture(route.file, stage, error); const response = await f.handlers[route.method](request(route));
        assert.equal(response.status, 503, `${route.file}/${stage}`);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-request-id"), "solicitud-test");
        const body = await response.json(); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
        assert.doesNotMatch(JSON.stringify(body), /detalle-sensible/); assert.equal(f.effects(), 0);
      }
    });
  }
  it("documentos y upload rechazan tenant ausente sin extracción ni firma", async () => {
    for (const route of routes.filter(r => r.file.includes("documents") || r.file.includes("storage"))) {
      const f = fixture(route.file, "missing-tenant", null); assert.equal((await f.handlers.POST(request(route))).status, 403); assert.equal(f.effects(), 0);
    }
  });
  it("documentos conserva 400 por falta de archivos y 413 por tamaño declarado", async () => {
    const route = routes.find(r => r.file.includes("documents"))!;
    const f = fixture(route.file, "none", null);
    assert.equal((await f.handlers.POST(request(route))).status, 400);
    assert.equal((await f.handlers.POST(new Request("https://example.invalid", { method: "POST", headers: { "content-length": String(50 * 1024 * 1024) } }))).status, 413);
    assert.equal(f.effects(), 0);
  });
});
