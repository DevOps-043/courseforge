import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import ts from "typescript";
import { load } from "./source-test-loader";

export const integrationId = "123e4567-e89b-42d3-a456-426614174000";
export const integrationOrg = "123e4567-e89b-42d3-a456-426614174001";
export const syntheticKey = "clave-sintetica-de-prueba";
export const assemblyPath = `assembly-branding/${integrationOrg}/outro/${integrationId}.mp4`;
export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
const logger = { createOperationalLogger: () => ({ error() {}, warn() {}, info() {} }), resolveCorrelationId: () => "integracion-test" };
const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
  "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors, "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
});
export const credentials = load<typeof import("../../../domains/production/providers/credentials/provider-credentials.service")>("src/domains/production/providers/credentials/provider-credentials.service.ts", {
  "../../../../lib/server/crypto": {}, "../heygen/heygen.client": {}, "./provider-credentials.repository": {},
});
export const liveavatar = load<typeof import("../../../domains/production/providers/liveavatar/liveavatar.client")>("src/domains/production/providers/liveavatar/liveavatar.client.ts", { "../../../../lib/server/outbound-http": {} });
export const generationSettings = load<typeof import("../../../domains/production/hyperframes/hyperframes-generation-settings.service")>("src/domains/production/hyperframes/hyperframes-generation-settings.service.ts", {
  "./video-studio-model-options": load("src/domains/production/hyperframes/video-studio-model-options.ts"),
});
const assembly = load("src/domains/production/assembly-branding/assembly-branding-upload.ts");
export interface IntegrationRoute { path: string; method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH"; body?: Record<string, unknown>; }
export const integrationRoutes: IntegrationRoute[] = [
  ...["heygen", "hyperframes"].flatMap(provider => [
    ...(["GET", "POST", "DELETE"] as const).map(method => ({ path: `${provider}/connection`, method, ...(method === "POST" ? { body: { apiKey: syntheticKey } } : {}) })),
    { path: `${provider}/connection/validate`, method: "POST" as const },
  ]),
  { path: "hyperframes/settings", method: "GET" },
  { path: "hyperframes/settings", method: "PUT", body: { ...generationSettings.DEFAULT_HYPERFRAMES_GENERATION_SETTINGS } },
  { path: "assembly-branding", method: "GET" },
  { path: "assembly-branding", method: "PUT", body: { assetId: null, kind: "OUTRO" } },
  { path: "assembly-branding", method: "PATCH", body: { fileSizeBytes: 1024, kind: "OUTRO", mimeType: "video/mp4", name: "Cierre", path: assemblyPath } },
  ...(["GET", "POST", "DELETE"] as const).map(method => ({ path: "liveavatar", method, ...(method === "POST" ? { body: { action: "connect", apiKey: syntheticKey } } : {}) })),
];
export function integrationRequest(route: IntegrationRoute, body = route.body) {
  return new Request("https://example.invalid", { method: route.method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
}
export type IntegrationStage = "identity" | "role" | "tenant";
interface FixtureOptions {
  stage?: IntegrationStage; failure?: unknown; missingAt?: IntegrationStage;
  serviceError?: unknown; failAt?: string; connected?: boolean; noSecret?: boolean;
  existingPath?: string; assetUnavailable?: boolean; badMetadata?: boolean; noVideo?: boolean; duration?: number;
}

export function integrationFixture(route: IntegrationRoute, options: FixtureOptions = {}) {
  const effects = { clients: 0, services: 0, reads: 0, writes: 0, webhooks: 0, providers: 0, media: 0, removed: 0, disposed: 0 };
  const events: { name: string; input: Record<string, unknown> }[] = [];
  const filters: { table: string; column: string; value: unknown }[] = [];
  const perform = <T>(kind: keyof typeof effects, name: string, input: Record<string, unknown>, result: T) => {
    effects[kind]++; events.push({ name, input });
    if (options.serviceError && (!options.failAt || options.failAt === name)) throw options.serviceError;
    return result;
  };
  const status = (provider: string, connected = options.connected ?? false) => ({ connected, provider, last4: null, lastValidatedAt: null, lastValidationError: null, metadata: {}, status: connected ? "ACTIVE" : null, validationStatus: connected ? "VALID" : null });
  class CredentialsService {
    constructor() { effects.services++; }
    async getCredentialStatus(input: { organizationId: string; provider: string }) { return perform("reads", "credential-status", input, status(input.provider)); }
    async getDecryptedSecret(input: Record<string, unknown>) { return perform("reads", "previous-secret", input, options.noSecret ? null : { secret: "clave-sintetica-anterior" }); }
    async upsertHeygenAvatarApiKey(input: Record<string, unknown>) { return perform("writes", "save-avatar", input, status("heygen_avatar", true)); }
    async upsertValidatedSecret(input: Record<string, unknown>) { return perform("writes", "save-liveavatar", input, status("liveavatar", true)); }
    async validateActiveHeygenAvatarCredential(input: Record<string, unknown>) { return perform("providers", "validate-avatar", input, status("heygen_avatar", true)); }
    async revokeCredential(input: { organizationId: string; provider: string }) { return perform("writes", "revoke", input, status(input.provider, false)); }
  }
  class HyperframesService {
    constructor() { effects.services++; }
    async getStatus(organizationId: string) { return perform("reads", "hyperframes-status", { organizationId }, status("hyperframes_cloud")); }
    async saveApiKey(input: Record<string, unknown>) { return perform("writes", "save-hyperframes", input, status("hyperframes_cloud", true)); }
    async validateActiveApiKey(organizationId: string) { return perform("providers", "validate-hyperframes", { organizationId }, status("hyperframes_cloud", true)); }
  }
  class LiveAvatarClient {
    constructor() { effects.services++; }
    async getCredits() { return perform("providers", "credits", {}, { remaining: 10 }); }
    async listAvatars() { return perform("providers", "avatars", {}, []); }
    async listPublicAvatars() { return perform("providers", "public-avatars", {}, []); }
    async listContexts() { return perform("providers", "contexts", {}, []); }
    async createEmbedding(input: Record<string, unknown>) { return perform("providers", "embedding", input, { testMarker: "embed" }); }
  }
  const admin = {
    from: (table: string) => {
      const read = () => perform("reads", "db-read", { table }, { data: table === "organization_assembly_assets"
        ? route.method === "GET" ? [] : route.method === "PATCH" ? options.existingPath ? { id: integrationId, storage_path: options.existingPath } : null : options.assetUnavailable ? null : { id: integrationId }
        : null, error: null });
      const query = {
        select: () => query, neq: () => query, order: () => query,
        eq: (column: string, value: unknown) => { filters.push({ table, column, value }); return query; },
        maybeSingle: async () => read(),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve(read()).then(resolve),
        upsert: async (input: Record<string, unknown>) => perform("writes", "db-upsert", input, { error: null }),
        insert: async (input: Record<string, unknown>) => perform("writes", "db-insert", input, { error: null }),
      }; return query;
    },
    rpc: async (name: string, input: Record<string, unknown>) => perform("writes", `rpc:${name}`, input, { error: null }),
    storage: { from: () => ({
      info: async (path: string) => perform("reads", "storage-info", { path }, { data: { size: options.badMetadata ? 2 : 1024, contentType: "video/mp4", version: "v1", etag: "etag-sintetico" }, error: null }),
      remove: async (paths: string[]) => perform("removed", "storage-remove", { paths }, { error: null }),
      createSignedUrl: async (path: string) => perform("reads", "storage-sign", { path }, { data: { signedUrl: "https://example.invalid/medio" }, error: null }),
    }) },
  };
  class MediaInput {
    constructor() { effects.media++; }
    async getPrimaryAudioTrack() { return null; }
    async getPrimaryVideoTrack() { return options.noVideo ? null : { getDisplayHeight: async () => 1080, getDisplayWidth: async () => 1920 }; }
    async getDurationFromMetadata() { return options.duration ?? 2; }
    dispose() { effects.disposed++; }
  }
  const fail = (stage: IntegrationStage) => { if (options.stage === stage) throw options.failure; };
  const file = `src/app/api/production/${route.path}/route.ts`;
  const imports: Record<string, unknown> = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles.filter(({ fileName }) => fileName.startsWith("@/")).map(({ fileName }) => [fileName, {}]));
  Object.assign(imports, {
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses, "@/lib/server/authorization-unavailable-response": mapper, "@/lib/server/operational-logger": logger,
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => { fail("identity"); return options.missingAt === "identity" ? null : { userId: integrationId }; },
      canReviewContent: async () => { fail("role"); return options.missingAt !== "role"; },
      getServiceRoleClient: () => { effects.clients++; return admin; },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => { fail("tenant"); return options.missingAt === "tenant" ? null : { organizationId: integrationOrg }; } },
    "@/domains/production/providers/credentials/provider-credentials.service": { ...credentials, ProductionProviderCredentialsService: CredentialsService },
    "@/domains/production/hyperframes/hyperframes-connection.service": { HyperframesConnectionService: HyperframesService },
    "@/domains/production/providers/liveavatar/liveavatar.client": { ...liveavatar, LiveAvatarClient },
    "@/domains/production/providers/heygen/heygen-webhook.service": Object.fromEntries([
      ["configureHeygenWebhook", "configure-avatar"], ["configureHeygenHyperframesWebhook", "configure-hyperframes"],
      ["disconnectHeygenWebhook", "disconnect-avatar"], ["disconnectHeygenHyperframesWebhook", "disconnect-hyperframes"],
    ].map(([key, name]) => [key, async (input: Record<string, unknown>) => perform("webhooks", name, input, undefined)])),
    "@/domains/production/hyperframes/hyperframes-generation-settings.service": { ...generationSettings,
      getHyperframesGenerationSettings: async (input: Record<string, unknown>) => perform("reads", "generation-settings", input, generationSettings.DEFAULT_HYPERFRAMES_GENERATION_SETTINGS),
      saveHyperframesGenerationSettings: async (input: Record<string, unknown>) => perform("writes", "save-settings", input, input.settings),
    },
    "@/domains/production/assembly-branding/assembly-branding-upload": assembly,
    mediabunny: { ALL_FORMATS: [], Input: MediaInput, UrlSource: class {} },
  });
  const handlers = load<Record<string, (request: Request) => Promise<Response>>>(file, imports);
  return { effects, events, filters, run: (request = integrationRequest(route)) => handlers[route.method](request) };
}
