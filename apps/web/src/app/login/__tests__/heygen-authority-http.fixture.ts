import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { load } from "./source-test-loader";
import { httpRuntime, validators, platformValidators, productionTypes, heygenApi, credentials, video, scenes, platform, catalog, constraints, type TestLog } from "./heygen-authority-http.runtime";

export const actorId = "123e4567-e89b-42d3-a456-426614174000";
export const organizationId = "123e4567-e89b-42d3-a456-426614174001";
export const componentId = "123e4567-e89b-42d3-a456-426614174002";
export const jobId = "123e4567-e89b-42d3-a456-426614174003";
export const clip = { id: "clip-1", order: 1, script_text: "Texto sintético", status: "DRAFT" };
export type HeygenStage = "identity" | "role" | "tenant" | "component";
export interface HeygenRoute {
  path: string; method: "GET" | "POST" | "PATCH" | "DELETE"; component?: boolean;
  body?: Record<string, unknown>; query?: string; status?: number;
}
export const heygenRoutes: HeygenRoute[] = [
  { path: "assets", method: "GET", query: "?limit=200&token=pagina-sintetica" },
  { path: "assets", method: "POST", body: { action: "prepare", contentType: "video/mp4", fileName: "sintetico.mp4", sizeBytes: 1024 } },
  { path: "platform", method: "GET" },
  { path: "platform", method: "POST", body: { action: "design_voice", prompt: "Voz sintética" }, status: 202 },
  { path: "platform", method: "PATCH", body: { defaultLocale: "es-MX" } },
  { path: "presets", method: "GET" },
  { path: "presets", method: "PATCH", body: { archived: true, kind: "avatar", presetId: actorId } },
  { path: "scenes", method: "GET", component: true, query: `?componentId=${componentId}` },
  { path: "scenes", method: "POST", component: true, body: { componentId } },
  { path: "scenes", method: "PATCH", component: true, body: { componentId, clips: [clip] } },
  { path: "scenes", method: "DELETE", component: true, body: { componentId, clipIds: [clip.id] } },
  { path: "speech", method: "POST", component: true, body: { componentId } },
  { path: "sync", method: "POST", status: 202 },
  { path: "videos", method: "POST", component: true, body: { componentId }, status: 202 },
  { path: "clips/generate", method: "POST", component: true, body: { componentId, clipIds: [clip.id], clips: [clip], generationTarget: "avatar" }, status: 202 },
  { path: "clips/status", method: "GET", component: true, query: `?componentId=${componentId}` },
  { path: "clips/voice", method: "POST", component: true, body: { componentId, clipIds: [clip.id] } },
  { path: "jobs", method: "GET", component: true, query: `?componentId=${componentId}` },
  { path: "jobs/[jobId]", method: "GET", query: "?autoPromote=true" },
];
export const stages = (route: HeygenRoute): HeygenStage[] => ["identity", "role", "tenant", ...(route.component ? ["component" as const] : [])];
export interface HeygenFixtureOptions {
  stage?: HeygenStage; failure?: unknown; missingAt?: HeygenStage;
  operationError?: unknown; failAt?: string; archiveResult?: string;
  latestJob?: Record<string, unknown> | null; composition?: boolean;
}

export function heygenFixture(route: HeygenRoute, options: HeygenFixtureOptions = {}) {
  const effects = { clients: 0, services: 0, credentials: 0, reads: 0, writes: 0, provider: 0, signatures: 0, dispatches: 0, background: 0, storage: 0 };
  const events: { name: string; input: unknown }[] = [];
  const filters: { table: string; column: string; value: unknown }[] = [];
  const logs: TestLog[] = [];
  const fail = (stage: HeygenStage) => { if (stage === options.stage) throw options.failure; };
  const perform = <T>(kind: keyof typeof effects, name: string, input: unknown, result: T): T => {
    effects[kind]++; events.push({ name, input });
    if (options.operationError && (!options.failAt || options.failAt === name)) throw options.operationError;
    return result;
  };
  const generatedVoice = { voiceAsset: { id: actorId, providerRequestId: "speech-sintetico" }, status: "SUCCEEDED" };
  const requestStatus = { asset: null, voiceAsset: null, jobId, providerJobId: null, scriptHash: null, status: "PENDING" };
  const recovered = { avatar_clips: [clip], voice_clips: [], avatar_generation_mode: "scene_clips" };
  const admin = {
    from: (table: string) => {
      const query = {
        select: () => query, neq: () => query,
        eq: (column: string, value: unknown) => { filters.push({ table, column, value }); return query; },
        upsert: (input: unknown, settings: unknown) => { perform("writes", "upsert-voice", { table, input, settings }, undefined); return query; },
        maybeSingle: async () => ({ data: perform("reads", "composition", {}, options.composition ? { id: actorId } : null), error: null }),
        single: async () => ({ data: { id: actorId }, error: null }),
      };
      return query;
    },
    storage: { from: (bucket: string) => ({
      upload: async (path: string, bytes: unknown, settings: unknown) => perform("storage", "upload-voice", { bucket, path, bytes, settings }, { error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.invalid/${bucket}/${path}` } }),
    }) },
  };
  class Repository {
    constructor() { effects.services++; }
    async listAvatarPresets(input: unknown) { return perform("reads", "avatars", input, []); }
    async listVoicePresets(input: unknown) { return perform("reads", "voices", input, []); }
    async listArchivedAvatarPresets(input: unknown) { return perform("reads", "archived-avatars", input, []); }
    async listArchivedVoicePresets(input: unknown) { return perform("reads", "archived-voices", input, []); }
    async listUnavailableCatalog(input: unknown) { return perform("reads", "unavailable", input, []); }
    async getWorkspaceSyncStatus(input: unknown) { return perform("reads", "sync-status", input, null); }
    async setCatalogPresetArchived(input: unknown) { return perform("writes", "archive", input, options.archiveResult ?? "UPDATED"); }
    async beginCatalogSync(input: unknown) { return perform("writes", "reserve-sync", input, jobId); }
    async markCatalogSyncIncomplete(input: unknown) { return perform("writes", "compensate-sync", input, undefined); }
    async getVoicePresetForGeneration(input: unknown) { return perform("reads", "voice-preset", input, { heygen_voice_id: "voz-sintetica" }); }
    async getLatestHeygenMediaJobForComponent(input: unknown) { return perform("reads", "latest-job", input, options.latestJob ?? null); }
    async findAvatarVideoAssetByJob(...input: unknown[]) { return perform("reads", "video-asset", input, { id: actorId, public_url: "https://example.invalid/video", storage_path: "video.mp4" }); }
    async findVoiceAudioAssetByJob(...input: unknown[]) { return perform("reads", "voice-asset", input, { id: actorId, public_url: "https://example.invalid/voz", storage_path: "voz.wav", duration_milliseconds: 1250 }); }
  }
  class ScenesService {
    constructor() { effects.services++; }
    async assertAvatarGenerationPreflight(input: unknown) { return perform("reads", "preflight", input, undefined); }
    async queueSceneClips(input: unknown) { return perform("writes", "queue-clips", input, { clips: [clip], voiceClips: [] }); }
    async markQueuedSceneClipsFailed(input: unknown) { return perform("writes", "fail-clips", input, undefined); }
    async refreshSceneClipStatuses(input: unknown) { return perform("provider", "refresh-clips", input, { clips: [clip] }); }
    async generateSceneVoiceClips(input: unknown) { return perform("provider", "scene-voices", input, generatedVoice); }
    async recoverHistoricalSceneAssets(input: unknown) { return perform("writes", "recover-scenes", input, recovered); }
    async recoverCompletedSceneAssets(input: unknown) { return perform("writes", "recover-completed", input, recovered); }
    buildSceneClips(input: unknown) { return perform("reads", "build-scenes", input, [clip]); }
    async saveSceneClips(input: unknown) { return perform("writes", "save-scenes", input, recovered); }
    async resetSceneAssets(input: unknown) { return perform("writes", "reset-scenes", input, { reset: true }); }
  }
  class VideoService {
    constructor() { effects.services++; }
    async getAvatarVideoJobStatus(input: unknown) { return perform("provider", "job-status", input, requestStatus); }
    async createVoiceoverForComponent(input: unknown) { return perform("provider", "component-voice", input, generatedVoice); }
  }
  class PlatformService {
    constructor() { effects.services++; }
    async getDashboard(input: unknown) { return perform("reads", "dashboard", input, { operations: [] }); }
    async refreshOperation(input: unknown) { return perform("provider", "operation", input, { status: "PENDING" }); }
    async searchAudio(input: unknown) { return perform("provider", "audio-search", input, []); }
    async submit(input: unknown) { return perform("writes", "submit-operation", input, { status: "PENDING" }); }
    async updateSettings(organizationId: string, settings: unknown) { return perform("writes", "settings", { organizationId, settings }, settings); }
  }
  const client = {
    platformRequest: async (input: unknown) => perform("provider", "platform-request", input, { marker: "asset-sintetico" }),
    generateSpeech: async (input: unknown) => perform("provider", "speech", input, { audioUrl: "https://example.invalid/audio.wav", requestId: "speech-sintetico", durationSeconds: 1, wordTimestamps: [] }),
  };
  const file = `src/app/api/production/heygen/${route.path}/route.ts`;
  const imports: Record<string, unknown> = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles.filter(({ fileName }) => fileName.startsWith("@/")).map(({ fileName }) => [fileName, {}]));
  Object.assign(imports, httpRuntime(logs), {
    "node:crypto": { default: { randomUUID } },
    "@/lib/errors": load("src/lib/errors.ts"),
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => { fail("identity"); return options.missingAt === "identity" ? null : { userId: actorId }; },
      canReviewContent: async () => { fail("role"); return options.missingAt !== "role"; },
      getServiceRoleClient: () => { effects.clients++; return admin; },
      getAuthorizedMaterialComponentAdmin: async () => { fail("component"); return options.missingAt === "component" ? null : { admin, component: { id: componentId, content: "Texto sintético", type: "VIDEO_THEORETICAL", assets: {} } }; },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => { fail("tenant"); return options.missingAt === "tenant" ? null : { organizationId }; } },
    "@/domains/production/providers/heygen/heygen.validators": validators,
    "@/domains/production/providers/heygen/heygen-platform.validators": platformValidators,
    "@/domains/production/types/production.types": productionTypes,
    "@/domains/production/providers/heygen/heygen.client": heygenApi,
    "@/domains/production/providers/heygen/heygen-catalog.service": catalog,
    "@/domains/production/providers/heygen/heygen-request-constraints": constraints,
    "@/domains/production/providers/heygen/heygen-credential-resolver.service": { ...credentials,
      getHeygenClientForOrganization: async (input: unknown) => perform("credentials", "credential", input, { client }),
    },
    "@/domains/production/providers/heygen/heygen.repository": { HeygenRepository: Repository },
    "@/domains/production/providers/heygen/heygen-scenes.service": { ...scenes, HeygenScenesService: ScenesService },
    "@/domains/production/providers/heygen/heygen-video.service": { ...video, HeygenVideoService: VideoService },
    "@/domains/production/providers/heygen/heygen-platform.service": { ...platform, HeygenPlatformService: PlatformService },
    "@/lib/server/background-payload-signature": { signBackgroundPayload: (input: unknown) => perform("signatures", "sign", input, { synthetic: input }) },
    "@/lib/server/background-function-client": { callBackgroundFunctionJson: async (...input: unknown[]) => perform("dispatches", "dispatch", input, undefined) },
    "@/domains/production/providers/heygen/heygen-audio-import.service": {
      assertSafeHeygenAudioUrl: (input: unknown) => perform("reads", "audio-url", input, undefined),
      downloadHeygenAudioWithLimits: async (input: unknown) => perform("reads", "audio-download", input, { buffer: Buffer.from("audio-sintetico"), extension: "wav", contentType: "audio/wav" }),
    },
    "@/domains/production/hyperframes/hyperframes-source-asset.service": {
      syncHyperframesSourceAssetsFromProduction: async (input: unknown) => perform("writes", "editor-sync", input, { synced: true }),
      extractHyperframesAnimatedDeck: () => null,
    },
    "@/domains/production/hyperframes/hyperframes-draft.service": { initializeHyperframesDraft: async (input: unknown) => perform("writes", "draft", input, { draftId: actorId }) },
    "@/domains/production/composition-editor/composition-narrative-source.service": { buildSceneVisualCatalog: () => [], validateSceneVisualPlans: (value: unknown) => value },
  });
  for (const [moduleName, exportName] of [["heygen-avatar-background.service", "runHeygenAvatarClipsBackground"], ["heygen-video-background.service", "runHeygenAvatarVideoBackground"], ["heygen-catalog-background.service", "runHeygenCatalogBackground"]]) {
    imports[`@/domains/production/providers/heygen/${moduleName}`] = { [exportName]: async (input: unknown) => perform("background", exportName, input, undefined) };
  }
  const handlers = load<Record<string, (request: Request, context?: unknown) => Promise<Response>>>(file, imports);
  const request = (body = route.body, query = route.query) => new Request(`https://example.invalid/${query ?? ""}`, { method: route.method,
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
  return { effects, events, filters, logs, request, run: (input = request()) => handlers[route.method](input, { params: Promise.resolve({ jobId }) }) };
}
