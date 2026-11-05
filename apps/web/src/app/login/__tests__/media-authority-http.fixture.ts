import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import ts from "typescript";
import { load } from "./source-test-loader";

export const mediaId = "123e4567-e89b-42d3-a456-426614174000";
export const organizationId = "123e4567-e89b-42d3-a456-426614174001";
export const signedUrl = "https://example.invalid/signed?token=sintetico";
export const mediaBucket = "fuentes-privadas";
export type MediaAuthorityStage = "identity" | "tenant" | "role" | "component";
export interface MediaRoute { path: string; method: "GET" | "POST"; query?: string; body?: Record<string, unknown>; stages: MediaAuthorityStage[]; }
const audioStages: MediaAuthorityStage[] = ["identity", "tenant", "role", "component"];
const reviewerStages: MediaAuthorityStage[] = ["identity", "tenant", "role"];
export const mediaRoutes: MediaRoute[] = [
  { path: "storage/media", method: "GET", query: `?bucket=${mediaBucket}&componentId=${mediaId}&path=voices/${mediaId}-voz.wav`, stages: ["identity", "component"] },
  { path: "production/assets/[assetId]/download", method: "GET", stages: reviewerStages },
  ...(["GET", "POST"] as const).map(method => ({ path: "production/audio-analysis/assets/[assetId]/waveform", method, stages: audioStages, query: `?componentId=${mediaId}`, body: { componentId: mediaId } })),
  ...(["GET", "POST"] as const).map(method => ({ path: "production/audio-processing/jobs", method, stages: audioStages, query: `?componentId=${mediaId}&sourceAssetId=${mediaId}`, body: { componentId: mediaId, sourceAssetId: mediaId } })),
  ...(["GET", "POST"] as const).map(method => ({ path: "production/sound-effects", method, stages: reviewerStages, body: { draftId: mediaId, soundEffectAssetId: mediaId } })),
  { path: "production/sound-effects/[soundEffectId]/preview", method: "GET", stages: reviewerStages },
  { path: "production/sound-effects/[soundEffectId]/download", method: "GET", stages: reviewerStages },
];

export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
const logger = { createOperationalLogger: () => ({ error() {}, warn() {}, info() {} }), resolveCorrelationId: () => "medio-test" };
const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
  "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors, "./api-contract": contract,
  "./api-response": responses, "./operational-logger": logger,
});
export const sfx = load<typeof import("../../../domains/production/sound-effects/sound-effect-library.service")>("src/domains/production/sound-effects/sound-effect-library.service.ts");
export const audio = load<typeof import("../../../domains/production/audio-processing/audio-processing-job.service")>("src/domains/production/audio-processing/audio-processing-job.service.ts", {
  "../jobs/production-jobs.service": {}, "../types/production.types": {}, "./audio-source-contract": {}, "./audio-source-policy": {},
  "./audio-processing-profiles": load("src/domains/production/audio-processing/audio-processing-profiles.ts"),
});
export const waveform = load<typeof import("../../../domains/production/audio-processing/audio-waveform-read.service")>("src/domains/production/audio-processing/audio-waveform-read.service.ts", { "./audio-waveform-cache.server": {}, "./audio-analysis.service": {} });
export const waveformJobs = load<typeof import("../../../domains/production/audio-processing/audio-waveform-job.service")>("src/domains/production/audio-processing/audio-waveform-job.service.ts", { "../jobs/production-jobs.service": {}, "../types/production.types": {}, "./audio-source-contract": {} });

interface FixtureOptions {
  stage?: MediaAuthorityStage;
  failure?: unknown;
  missingAt?: MediaAuthorityStage;
  domainError?: unknown;
  auditError?: unknown;
  storagePath?: string;
  resourceMissing?: boolean;
  contextOrganizationId?: string;
  job?: { status: string; output_snapshot?: Record<string, unknown> } | null;
}

export function mediaFixture(route: MediaRoute, options: FixtureOptions = {}) {
  const effects = { clients: 0, reads: 0, signs: 0, writes: 0, jobs: 0, audit: 0, context: 0 };
  const filters: { table: string; column: string; value: unknown }[] = [];
  const signatures: { bucket: string; path: string; ttl: number; download?: string }[] = [];
  const fail = (stage: MediaAuthorityStage) => { if (options.stage === stage) throw options.failure; };
  const domain = <T>(kind: keyof typeof effects, result: T) => { effects[kind]++; if (options.domainError) throw options.domainError; return result; };
  const storagePath = options.storagePath ?? `sound-effect-assets/organizations/${organizationId}/sonido.wav`;
  const job = { id: mediaId, status: "PENDING" };
  const source = { id: mediaId, public_url: null, duration_seconds: 2, duration_milliseconds: null };
  const admin = {
    from: (table: string) => {
      const query = {
        select: () => query, neq: () => query, contains: () => query, order: () => query, limit: () => query,
        eq: (column: string, value: unknown) => { filters.push({ table, column, value }); return query; },
        maybeSingle: async () => ({ data: domain("reads", table === "production_jobs" ? options.job ?? null : options.resourceMissing ? null : {
          id: mediaId, storage_bucket: "sound-effect-assets", storage_path: storagePath, metadata: { file_name: "descarga.wav" }, qa_status: "APPROVED",
        }), error: null }),
      }; return query;
    },
    storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string, ttl: number, settings?: { download?: string }) => {
      signatures.push({ bucket, path, ttl, ...settings }); return { data: domain("signs", { signedUrl }), error: null };
    } }) },
  };
  const file = `src/app/api/${route.path}/route.ts`;
  const imports: Record<string, unknown> = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles
    .filter(({ fileName }) => fileName.startsWith("@/")).map(({ fileName }) => [fileName, {}]));
  Object.assign(imports, {
    "next/server": { NextResponse }, "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/authorization-unavailable-response": mapper, "@/lib/server/operational-logger": logger,
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => { fail("identity"); return options.missingAt === "identity" ? null : { userId: mediaId }; },
      canReviewContent: async () => { fail("role"); return options.missingAt !== "role"; },
      getAuthorizedMaterialComponentAdmin: async () => { fail("component"); return options.missingAt === "component" ? null : { admin, component: { assets: {} } }; },
      getServiceRoleClient: () => { effects.clients++; return admin; },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => { fail("tenant"); return options.missingAt === "tenant" ? null : { organizationId, userId: mediaId }; } },
    "@/domains/production/media-storage.config": { HYPERFRAMES_PRIVATE_SOURCE_BUCKET: mediaBucket },
    "@/domains/materials/downloads/asset-access-audit.service": { recordAssetAccessAudit: async () => { effects.audit++; if (options.auditError) throw options.auditError; } },
    "@/domains/production/sound-effects/sound-effect-library.service": { ...sfx,
      getReadySoundEffectStorageIdentity: async () => domain("reads", { storageBucket: "sound-effect-assets", storagePath }),
      listReadySoundEffects: async () => domain("reads", []), linkReadySoundEffectToDraft: async () => domain("writes", { id: mediaId }),
      uploadVerifiedWavSoundEffect: async () => domain("writes", { id: mediaId }),
    },
    "@/domains/production/audio-processing/audio-processing-job.service": { ...audio,
      createAudioProcessingJob: async () => domain("jobs", job), resolveAudioProcessingSource: async () => domain("reads", source),
    },
    "@/domains/production/audio-processing/audio-source-policy": { getAudioSourceCapability: () => ({ eligible: true }) },
    "@/domains/production/audio-processing/audio-waveform-read.service": { ...waveform, readAudioWaveformPreview: async () => domain("reads", { testMarker: "waveform" }) },
    "@/domains/production/audio-processing/audio-waveform-job.service": { ...waveformJobs, createWaveformAnalysisJob: async () => domain("jobs", job) },
    "@/domains/production/jobs/production-jobs.service": { resolveProductionComponentContext: async () => { effects.context++; return { organizationId: options.contextOrganizationId ?? organizationId, componentId: mediaId }; } },
    "@/domains/production/types/production.types": load("src/domains/production/types/production.types.ts"),
  });
  const handlers = load<Record<string, (request: Request, context: { params: Promise<{ assetId: string; soundEffectId: string }> }) => Promise<Response>>>(file, imports);
  return { effects, filters, signatures,
    run: (request = new Request(`https://example.invalid/${route.query ?? ""}`, { method: route.method,
      ...(route.method === "POST" ? { headers: { "content-type": "application/json" }, body: JSON.stringify(route.body) } : {}) })) => handlers[route.method](request, { params: Promise.resolve({ assetId: mediaId, soundEffectId: mediaId }) }),
  };
}
