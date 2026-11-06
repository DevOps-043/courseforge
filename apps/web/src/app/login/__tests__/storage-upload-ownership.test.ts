import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { load } from "./source-test-loader";

const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", {
  "next/server": { NextResponse: { json: Response.json } }, "./api-contract": contract,
});
const errors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const identityErrors = load("src/lib/server/auth-identity-error.ts");
const logger = { createOperationalLogger: () => ({ error() {}, warn() {} }), resolveCorrelationId: () => "upload-test" };
const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
  "./api-contract": contract, "./api-response": responses, "./tenant-context-error": errors,
  "./auth-identity-error": identityErrors, "./operational-logger": logger,
});
const organizationId = "123e4567-e89b-42d3-a456-426614174000";
const artifactId = "123e4567-e89b-42d3-a456-426614174001";
const foreignId = "123e4567-e89b-42d3-a456-426614174002";
const thumbnail = { bucket: "thumbnails", purpose: "thumbnail", artifactId, contentType: "image/png", fileSizeBytes: 1024, filePath: "thumb.png" };

function fixture(options: { missingIdentity?: boolean; missingTenant?: boolean; artifactFailure?: Error; resourceOrganizationId?: string } = {}) {
  const signed: { bucket: string; path: string; upsert: boolean }[] = [];
  const artifacts: string[] = [];
  let serviceClients = 0;
  const authorizeArtifact = async (requestedId: string, tenant?: { organizationId: string }) => {
    artifacts.push(requestedId);
    if (tenant) assert.equal(tenant.organizationId, organizationId);
    if (options.artifactFailure) throw options.artifactFailure;
    return requestedId === artifactId
      ? { artifact: { id: artifactId, organization_id: options.resourceOrganizationId ?? organizationId } }
      : null;
  };
  const route = load<{ POST(request: Request): Promise<Response> }>("src/app/api/storage/signed-upload-url/route.ts", {
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/authorization-unavailable-response": mapper, "@/lib/server/operational-logger": logger,
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => options.missingTenant ? null : { organizationId } },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => options.missingIdentity ? null : { userId: artifactId },
      getAuthorizedArtifactAdmin: authorizeArtifact, getAuthorizedArtifactAdminForTenant: authorizeArtifact,
      getServiceRoleClient: () => { serviceClients++; return { storage: { from: (bucket: string) => ({
        createSignedUploadUrl: async (path: string, settings: { upsert: boolean }) => {
          signed.push({ bucket, path, ...settings });
          return { data: { path, token: "token-sintetico", signedUrl: "https://example.invalid/upload" }, error: null };
        },
      }) } }; },
    },
    "@/domains/production/hyperframes/hyperframes-media-constraints": {},
    "@/domains/production/hyperframes/hyperframes.types": {},
    "@/domains/production/media-storage.config": { HYPERFRAMES_PRIVATE_SOURCE_BUCKET: "fuentes-privadas" },
    "@/domains/publication/thumbnail-upload-policy": load("src/domains/publication/thumbnail-upload-policy.ts"),
  });
  return { signed, artifacts, serviceClients: () => serviceClients,
    post: (body: Record<string, unknown>) => route.POST(new Request("https://example.invalid", { method: "POST", body: JSON.stringify(body) })) };
}

describe("ownership de firma genérica de uploads", () => {
  it("miniatura autorizada genera path nuevo del recurso sin sobrescritura", async () => {
    const f = fixture();
    for (const [contentType, extension] of [["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"], ["image/gif", "gif"]]) {
      const response = await f.post({ ...thumbnail, filePath: `organizations/${foreignId}/ajena.png`, contentType, upsert: true });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.match(body.path, new RegExp(`^organizations/${organizationId}/artifacts/${artifactId}/[0-9a-f-]{36}\\.${extension}$`));
      assert.equal(body.token, "token-sintetico"); assert.equal(body.signedUrl, "https://example.invalid/upload");
      assert.equal(f.signed.at(-1)!.upsert, false);
    }
    assert.equal(new Set(f.signed.map(s => s.path)).size, 4);
    assert.deepEqual(f.artifacts, Array(4).fill(artifactId));
    const first = await f.post({ ...thumbnail, filePath: undefined });
    const second = await f.post({ ...thumbnail, filePath: undefined });
    assert.equal(first.status, 200); assert.equal(second.status, 200);
    assert.notEqual((await first.json()).path, (await second.json()).path);
  });
  it("rechaza artefacto ajeno y discordancia de tenant sin abrir Storage", async () => {
    for (const [options, body, status] of [
      [{}, { ...thumbnail, artifactId: foreignId }, 404],
      [{ resourceOrganizationId: foreignId }, thumbnail, 403],
    ] as const) {
      const f = fixture(options); assert.equal((await f.post(body)).status, status);
      assert.equal(f.serviceClients(), 0); assert.equal(f.signed.length, 0);
    }
  });
  it("falla cerrado sin identidad, tenant o autoridad del artefacto", async () => {
    for (const [options, status] of [
      [{ missingIdentity: true }, 401], [{ missingTenant: true }, 403],
      [{ artifactFailure: new errors.TenantContextLookupError() }, 503],
    ] as const) {
      const f = fixture(options); const response = await f.post(thumbnail);
      assert.equal(response.status, status); assert.equal(f.serviceClients(), 0);
      if (status === 503) { assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal((await response.json()).retryable, true); }
    }
  });
  it("no permite omitir recurso, MIME o tamaño ni exceder 5 MiB", async () => {
    for (const patch of [{ artifactId: undefined }, { contentType: undefined }, { contentType: "image/svg+xml" }, { fileSizeBytes: undefined }, { fileSizeBytes: 0 }, { fileSizeBytes: 5 * 1024 * 1024 + 1 }]) {
      const f = fixture(); const response = await f.post({ ...thumbnail, ...patch });
      assert.ok([400, 413].includes(response.status)); assert.equal(f.serviceClients(), 0);
    }
    const f = fixture(); assert.equal((await f.post({ ...thumbnail, fileSizeBytes: 5 * 1024 * 1024 })).status, 200);
  });
  it("propósitos alternativos no evaden ownership ni habilitan firma de vídeos", async () => {
    for (const bucket of ["thumbnails", "production-videos"]) {
      for (const purpose of [undefined, "thumbnail", "production-video", "production-asset", "bundle-agent-reference", "curation-source-pdf", "assembly-branding"]) {
        if (bucket === "thumbnails" && purpose === "thumbnail") continue;
        const f = fixture(); const response = await f.post({ ...thumbnail, bucket, purpose, upsert: true });
        assert.equal(response.status, 400, `${bucket}/${purpose}`); assert.equal(f.signed.length, 0);
      }
    }
    for (const purpose of ["thumbnail", "production-video"]) {
      const f = fixture(); assert.equal((await f.post({ ...thumbnail, bucket: "production-assets", purpose })).status, 400);
      assert.equal(f.signed.length, 0);
    }
  });
});
