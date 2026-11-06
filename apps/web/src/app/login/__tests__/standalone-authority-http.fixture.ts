import { readFileSync } from "node:fs";
import * as nodeCrypto from "node:crypto";
import ts from "typescript";
import { load } from "./source-test-loader";
import { httpRuntime, identityErrors, tenantErrors, credentials, heygenApi, constraints, type TestLog } from "./heygen-authority-http.runtime";
import * as mediaTypes from "../../../domains/production/standalone/standalone-media.types";
import * as heygenTypes from "../../../domains/production/providers/heygen/heygen.types";
import * as accessContract from "../../../domains/production/providers/heygen/heygen-standalone-video-access.contract";

export { identityErrors, tenantErrors, credentials, heygenApi };
export const organizationId = "aaaaaaaa-1111-4111-8111-111111111111";
export const otherOrganizationId = "bbbbbbbb-2222-4222-8222-222222222222";
export const componentId = "cccccccc-3333-4333-8333-333333333333";
export const assetId = "dddddddd-4444-4444-8444-444444444444";
export const videoId = "video-1";
export const key = "clave-sintetica-exclusiva-standalone-tests-0123456789";
export const clock = 1_800_000_000_000;
export const accessFile = "src/domains/production/providers/heygen/heygen-standalone-video-access.server.ts";
type AccessModule = typeof import("../../../domains/production/providers/heygen/heygen-standalone-video-access.server");
const issuer = load<AccessModule>(accessFile, { "../../../../lib/server/env": { getBackgroundFunctionSecret: () => key } });
const mediaFile = "src/domains/production/standalone/standalone-media.service.ts";
const mediaImports = Object.fromEntries(ts.preProcessFile(readFileSync(mediaFile, "utf8")).importedFiles.map(({ fileName }) => [fileName, {}]));
export const mediaErrors = load<typeof import("../../../domains/production/standalone/standalone-media.service")>(mediaFile, mediaImports);
export type Operation = "create" | "status" | "media";
export type Gate = "identity" | "review" | "tenant" | "component" | "register";
interface Options {
  organization?: string; token?: string | null; tokenOrganization?: string; tokenVideo?: string; tokenIssuedAt?: number;
  gate?: Gate; failure?: unknown; deny?: Gate; keyFailure?: boolean;
  providerFailure?: unknown; credentialFailure?: unknown; status?: string; returnedVideoId?: string;
  missingAvatar?: boolean; missingVoice?: boolean;
}
type Handler = (request: Request, context: { params: Promise<{ videoId: string }> }) => Promise<Response>;
export function fixture(operation: Operation, options: Options = {}) {
  const logs: TestLog[] = [];
  const effects: Array<{ kind: string; value?: unknown }> = [];
  const effect = (kind: string, value?: unknown) => effects.push({ kind, value });
  const gate = (name: Gate) => { effect(name); if (options.gate === name) throw options.failure; return options.deny !== name; };
  const accessModule = load<AccessModule>(accessFile, { "../../../../lib/server/env": { getBackgroundFunctionSecret: () => {
    if (options.keyFailure) throw new Error("CANARIO_PRIVADO"); return key;
  } } });
  const organization = options.organization || organizationId;
  const defaultToken = options.token === undefined ? issuer.createHeygenStandaloneVideoAccess(options.tokenOrganization || organization, () => options.tokenIssuedAt ?? clock).issue(options.tokenVideo || videoId) : options.token;
  const admin = { nombre: "cliente-simulado" };
  const providerClient = {
    createAvatarVideo: async (input: unknown, idempotencyKey: string) => { effect("createVideo", { input, idempotencyKey }); if (options.providerFailure) throw options.providerFailure; return { videoId: options.returnedVideoId ?? videoId, providerStatus: "pending" }; },
    getVideo: async (id: string) => { effect("getVideo", id); if (options.providerFailure) throw options.providerFailure; return { videoId: options.returnedVideoId ?? id, status: options.status || "completed", videoUrl: "https://provider.test/video.mp4" }; },
  };
  const imports = {
    ...httpRuntime(logs), crypto: { default: nodeCrypto },
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => gate("identity") ? { userId: "actor" } : null,
      canReviewContent: async (userId: string, tenant: unknown) => { effect("review.input", { userId, tenant }); return gate("review"); },
      getServiceRoleClient: () => { effect("admin"); return admin; },
      getAuthorizedMaterialComponentAdmin: async (id: string) => { effect("component.id", id); return gate("component") ? { admin, component: { id } } : null; },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => gate("tenant") ? { organizationId: organization, userId: "actor", platformRole: "admin" } : null },
    "@/domains/production/providers/heygen/heygen.client": heygenApi,
    "@/domains/production/providers/heygen/heygen.types": heygenTypes,
    "@/domains/production/providers/heygen/heygen-request-constraints": constraints,
    "@/domains/production/providers/heygen/heygen-standalone-video-access.contract": accessContract,
    "@/domains/production/providers/heygen/heygen-standalone-video-access.server": {
      ...accessModule, createHeygenStandaloneVideoAccess: (id: string) => {
        effect("access", id); const access = accessModule.createHeygenStandaloneVideoAccess(id, () => clock);
        return { issue: (id: string) => { effect("issue", id); return access.issue(id); }, verify: (token: string | null, id: string) => { effect("verify", id); return access.verify(token, id); } };
      },
    },
    "@/domains/production/providers/heygen/heygen-credential-resolver.service": {
      ...credentials, getHeygenClientForOrganization: async (value: unknown) => { effect("credentials", value); if (options.credentialFailure) throw options.credentialFailure; return { client: providerClient }; },
    },
    "@/domains/production/providers/heygen/heygen.repository": { HeygenRepository: class {
      getAvatarPresetForGeneration(value: unknown) { effect("avatar", value); return options.missingAvatar ? null : { heygen_avatar_look_id: "look", default_voice_id: options.missingVoice ? null : "voice-default" }; }
      getVoicePresetForGeneration(value: unknown) { effect("voice", value); return { heygen_voice_id: "voice-selected" }; }
    } },
    "@/domains/production/standalone/standalone-media.types": mediaTypes,
    "@/domains/production/standalone/standalone-media.service": { ...mediaErrors, registerStandaloneMedia: async (value: unknown) => { gate("register"); effect("registration.input", value); } },
  };
  const path = operation === "media" ? "standalone/media" : `heygen/standalone/videos${operation === "status" ? "/[videoId]" : ""}`;
  const handler = load<Record<string, Handler>>(`src/app/api/production/${path}/route.ts`, imports)[operation === "status" ? "GET" : "POST"];
  const request = (overrides: { body?: unknown; rawBody?: string; headers?: Record<string, string>; video?: string; token?: string | null } = {}) => {
    const token = overrides.token === undefined ? defaultToken : overrides.token;
    return handler(new Request(`https://local.test/api/production/${path}`, {
      method: operation === "status" ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { [accessContract.HEYGEN_STANDALONE_VIDEO_TOKEN_HEADER]: token } : {}), ...overrides.headers },
      ...(operation === "status" ? {} : { body: overrides.rawBody ?? JSON.stringify(overrides.body ?? (operation === "media" ? { componentId, assetId, fileName: "imagen.png", extension: "png" } : { title: "Vídeo standalone", script: "Este es un guion de prueba suficientemente largo." })) }),
    }), { params: Promise.resolve({ videoId: overrides.video ?? videoId }) });
  };
  return { request, effects, logs, token: defaultToken };
}
