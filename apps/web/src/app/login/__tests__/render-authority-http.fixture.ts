import { readFileSync } from "node:fs";
import ts from "typescript";
import { NextResponse } from "next/server";
import { load } from "./source-test-loader";
import * as validation from "../../../domains/production/hyperframes/hyperframes-request-validation";

export const id = "11111111-1111-4111-8111-111111111111";
export const attemptId = "22222222-2222-4222-8222-222222222222";
export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const serviceFile = "src/domains/production/hyperframes/hyperframes-render-submission.service.ts";
const isolatedImports = Object.fromEntries(ts.preProcessFile(readFileSync(serviceFile, "utf8")).importedFiles.map(({ fileName }) => [fileName, {}]));
export const serviceErrors = load<typeof import("../../../domains/production/hyperframes/hyperframes-render-submission.service")>(serviceFile, isolatedImports);
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
export type Stage = "identity" | "tenant" | "review" | "recovery" | "submit" | "dispatch" | "compensation";
interface Options { stage?: Stage; failure?: unknown; deny?: Stage; reused?: boolean; providerRenderId?: string; emptyRecovery?: boolean; dispatchFailure?: unknown; compensationFailure?: unknown; }
export function fixture(options: Options = {}) {
  const effects: Array<{ kind: string; value?: unknown }> = [];
  const effect = (kind: string, value?: unknown) => effects.push({ kind, value });
  const stage = (name: Stage) => { effect(name); if (options.stage === name) throw options.failure; return options.deny !== name; };
  const tenant = { organizationId: "organizacion-vigente", userId: "actor", platformRole: "admin" };
  const admin = { cliente: "simulado" };
  const logger = { createOperationalLogger: () => ({
    error: (event: string, error: unknown) => effect("log.error", { event, message: String(error) }),
    warn: (event: string, fields: unknown) => effect("log.warn", { event, fields }),
  }), resolveCorrelationId: () => "render-autoridad-test" };
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors,
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  const handlers = load<Record<string, (request: Request) => Promise<Response>>>("src/app/api/production/hyperframes/renders/route.ts", {
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "@/lib/server/authorization-unavailable-response": mapper,
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => stage("tenant") ? tenant : null },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => stage("identity") ? { userId: "actor" } : null,
      canReviewContent: async (userId: string, resolvedTenant: unknown) => { effect("review.input", { userId, tenant: resolvedTenant }); return stage("review"); },
      getServiceRoleClient: () => { effect("admin"); return admin; },
    },
    "@/domains/production/hyperframes/hyperframes-request-validation": validation,
    "@/domains/production/hyperframes/hyperframes-render-recovery.service": { HyperframesRenderRecoveryService: class {
      async findLatestForComposition(value: unknown) { stage("recovery"); effect("recovery.input", value); return options.emptyRecovery ? null : { renderRequestId: id, status: "QUEUED" }; }
    } },
    "@/domains/production/hyperframes/hyperframes-render-submission.service": {
      HyperframesRenderSubmissionError: serviceErrors.HyperframesRenderSubmissionError,
      HyperframesRenderSubmissionService: class {
        async submit(value: unknown) { stage("submit"); effect("submit.input", value); return { renderRequestId: id, status: "QUEUED", reused: options.reused || false, providerRenderId: options.providerRenderId || null }; }
        async failDispatch(value: unknown) { stage("compensation"); effect("compensation.input", value); if (options.compensationFailure) throw options.compensationFailure; }
      },
    },
    "@/lib/server/background-function-client": { callBackgroundFunctionJson: async (name: string, payload: unknown) => {
      stage("dispatch"); effect("dispatch.input", { name, payload }); if (options.dispatchFailure) throw options.dispatchFailure;
    } },
  });
  const request = (method: "GET" | "POST", overrides: { body?: unknown; rawBody?: string; headers?: Record<string, string>; query?: string } = {}) => handlers[method](new Request(`https://local.test/api/production/hyperframes/renders?${overrides.query ?? `compositionId=${id}`}`, {
    method, headers: { "Content-Type": "application/json", ...overrides.headers },
    ...(method === "GET" ? {} : { body: overrides.rawBody ?? JSON.stringify(overrides.body ?? { revisionId: id, aspectRatio: "16:9", attemptId }) }),
  }));
  return { effects, request };
}
