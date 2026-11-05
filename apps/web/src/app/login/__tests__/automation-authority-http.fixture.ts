import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { NextResponse } from "next/server";
import { load } from "./source-test-loader";
import * as configuration from "../../../domains/production/automation/production-automation-configuration";

export const runId = "11111111-1111-4111-8111-111111111111";
export const componentId = "22222222-2222-4222-8222-222222222222";
export const artifactId = "33333333-3333-4333-8333-333333333333";
export const presetId = "44444444-4444-4444-8444-444444444444";
export const avatar = { aspectRatio: "16:9", avatarPresetId: presetId, voicePresetId: presetId, caption: false, engine: "avatar_iv", generationMode: "scene_clips", outputFormat: "mp4", resolution: "1080p" };
export const cases = [
  ["runs", "GET"], ["runs", "POST"], ["runs/[runId]", "GET"], ["runs/[runId]", "POST"],
  ["runs/[runId]/configuration", "PUT"], ["runs/[runId]/dispatch", "POST"],
  ["runs/[runId]/items/[componentId]/clips", "POST"], ["runs/[runId]/items/[componentId]/clips", "PUT"],
] as const;
export type Operation = typeof cases[number];
export type Gate = "identity" | "tenant" | "review" | "artifact";
export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
function isolated<T>(file: string): T {
  const imports = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles.map(({ fileName }) => [fileName, {}]));
  return load<T>(file, imports);
}
export const runErrors = isolated<typeof import("../../../domains/production/automation/production-automation-run.service")>("src/domains/production/automation/production-automation-run.service.ts");
type Handler = (request: Request, context: { params: Promise<{ runId: string; componentId: string }> }) => Promise<Response>;
interface Options {
  gate?: Gate; failure?: unknown; deny?: Gate; serviceFailure?: unknown; dispatchFailure?: unknown;
  missingRun?: boolean; missingItem?: boolean; missingComponent?: boolean; wrongArtifact?: boolean;
  queryFailure?: boolean; updateFailure?: boolean;
}
export function fixture([route, method]: Operation, options: Options = {}) {
  const effects: Array<{ kind: string; value?: unknown }> = [];
  const effect = (kind: string, value?: unknown) => effects.push({ kind, value });
  const gate = (name: Gate) => { effect(name); if (options.gate === name) throw options.failure; return options.deny !== name; };
  const logger = { createOperationalLogger: () => ({
    error: (event: string, error: unknown) => effect("log.error", { event, message: String(error) }),
    warn: (event: string, fields: unknown) => effect("log.warn", { event, fields }),
  }), resolveCorrelationId: () => "automatizacion-autoridad-test" };
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors,
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  const item = { id: "item", material_component_id: componentId, configuration: {}, requirements: [{ kind: "AVATAR_AND_VOICE" }] };
  const admin = { from: (table: string) => {
    effect("query", table);
    let updating = false;
    const result = () => ({ data: table === "production_run_items" ? (options.missingItem ? [] : [item]) : null,
      error: options.queryFailure || (updating && options.updateFailure) ? new Error("Consulta fallida") : null });
    const query = {
      select: () => query, in: () => query, order: () => query, limit: () => query,
      eq: (column: string, value: unknown) => { effect("filter", { table, column, value }); return query; },
      update: (value: unknown) => { updating = true; effect("update", { table, value }); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      maybeSingle: async () => ({ data: table === "production_runs" ? (options.missingRun ? null : { id: runId, configuration: { defaults: { nativeCaptions: true } } })
        : table === "production_run_items" ? (options.missingItem ? null : item)
        : (options.missingComponent ? null : { id: componentId, assets: {}, content: {} }), error: result().error }),
    };
    return query;
  } };
  const tenant = { organizationId: "organizacion-vigente", userId: "actor", platformRole: "admin" };
  const callService = (name: string, value: unknown) => { effect(name, value); if (options.serviceFailure) throw options.serviceFailure; return { id: runId, status: "PLANNING" }; };
  const handlers = load<Record<string, Handler>>(`src/app/api/production/automation/${route}/route.ts`, {
    zod: { z }, "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "@/lib/server/authorization-unavailable-response": mapper,
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => gate("identity") ? { userId: "actor" } : null,
      canReviewContent: async (userId: string, resolvedTenant: unknown) => { effect("review.input", { userId, tenant: resolvedTenant }); return gate("review"); },
      getServiceRoleClient: () => { effect("admin"); return admin; },
      getAuthorizedArtifactAdminForTenant: async (id: string, resolvedTenant: unknown) => {
        effect("artifact.input", { id, tenant: resolvedTenant });
        return gate("artifact") ? { admin, artifact: { organization_id: options.wrongArtifact ? "ajena" : tenant.organizationId } } : null;
      },
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => gate("tenant") ? tenant : null },
    "@/domains/production/automation/production-automation-configuration": configuration,
    "@/domains/production/automation/production-automation-run.service": {
      ProductionAutomationRunError: runErrors.ProductionAutomationRunError,
      ProductionAutomationRunService: class {
        constructor() { effect("service"); }
        createRun(value: unknown) { return callService("create", value); }
        getRun(id: string, organizationId: string) { return callService("get", { id, organizationId }); }
        refreshRun(id: string, organizationId: string, input: unknown) { return callService("refresh", { id, organizationId, input }); }
      },
    },
    "@/domains/production/providers/heygen/heygen-scenes.service": { HeygenScenesService: class {
      constructor() { effect("scenes"); }
      buildSceneClips(value: unknown) { effect("build", value); return [{ id: "clip", script: "Texto" }]; }
      async saveSceneClips(value: { clips: unknown[]; componentId: string }) { effect("save", value); if (options.serviceFailure) throw options.serviceFailure; return { avatar_clips: value.clips }; }
    } },
    "@/lib/server/background-payload-signature": { signBackgroundPayload: (value: unknown) => { effect("sign", value); return { signed: value }; } },
    "@/lib/server/background-function-client": { callBackgroundFunctionJson: async (name: string, value: unknown, callbacks: unknown) => {
      effect("dispatch", { name, value, callbacks }); if (options.dispatchFailure) throw options.dispatchFailure;
    } },
    "@/domains/production/automation/production-automation-background.service": { runProductionAutomationBackground: async (value: unknown) => { effect("worker", value); } },
  });
  const request = (overrides: { body?: unknown; rawBody?: string; headers?: Record<string, string>; run?: string; component?: string; query?: string } = {}) => {
    const body = overrides.rawBody ?? JSON.stringify(overrides.body ?? (route === "runs" ? { artifactId }
      : route.endsWith("configuration") ? { items: [{ componentId, nativeCaptions: false }] }
      : route.endsWith("clips") && method === "PUT" ? { clips: [{ id: "clip", avatarPresetId: presetId, voicePresetId: presetId }] } : {}));
    return handlers[method](new Request(`https://local.test/api/production/automation/${route}?${overrides.query ?? `artifactId=${artifactId}`}`, {
      method, headers: { "content-type": "application/json", ...overrides.headers }, ...(method === "GET" ? {} : { body }),
    }), { params: Promise.resolve({ runId: overrides.run || runId, componentId: overrides.component || componentId }) });
  };
  return { effects, request };
}
