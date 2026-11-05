import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import { load } from "./source-test-loader";
import { HTML_ROUTE_POLICIES } from "./hyperframes-html-route.policies";
import * as resourcePolicy from "../../../domains/production/composition-editor/composition-html-editing-reconstruction-resource-link.contract";
import * as previewConfiguration from "../../../domains/production/composition-editor/composition-html-editing-preview-configuration.server";
import { SHARED_ROUTE_CASES } from "./hyperframes-shared-route.cases";

export type SharedRouteCase = typeof SHARED_ROUTE_CASES[number];
export const sharedActorId = "11111111-1111-4111-8111-111111111111";
export const sharedOrganizationId = "22222222-2222-4222-8222-222222222222";
type Tenant = { userId: string; organizationId: string; platformRole: string };
type CapturedOptions = {
  enabled?: (method?: string) => boolean;
  authenticate?: () => Promise<{ actorId: string | null; tenant: Tenant | null }>;
  authorize?: () => Promise<{ status: string; organizationId?: string; userId?: string }>;
  serviceClient?: () => unknown; responseKind?: string;
  configuration?: () => { key: Uint8Array; audience: string; storageOrigin: string; runtimeWebRoot?: string };
};
const domain = "src/domains/production/composition-editor/";
const http = domain + "http/";
const roots = new Set([
  http + "composition-narrative-extraction-handlers.server.ts",
  http + "composition-narrative-fragment-command-handlers.server.ts",
  http + "composition-narrative-extraction-rollout.server.ts",
  http + "composition-narrative-fragment-rollout.server.ts",
  http + "composition-html-editing-reconstruction-resource-route.server.ts",
  domain + "composition-html-editing-preview-route.server.ts",
]);
function canonical(specifier: string, owner: string) {
  const resolved = specifier.startsWith("@/") ? "src/" + specifier.slice(2)
    : path.posix.normalize(path.posix.join(path.posix.dirname(owner), specifier));
  return resolved.endsWith(".ts") ? resolved : resolved + ".ts";
}

export function sharedRouteFixture(entry: SharedRouteCase) {
  const effects: string[] = [];
  const environment: Record<string, string | undefined> = {};
  const state = { actorId: sharedActorId as string | null,
    tenant: { userId: sharedActorId, organizationId: sharedOrganizationId, platformRole: "ADMIN" } as Tenant | null,
    reviewAllowed: true, identityFailure: null as unknown, tenantFailure: null as unknown, reviewFailure: null as unknown };
  const captured = new Map<string, CapturedOptions>();
  const cache = new Map<string, Record<string, unknown>>();
  const request = new Request("https://caller.invalid/route?organizationId=forjada&audience=https://caller.invalid", { method: entry.method });
  const params = { draftId: sharedActorId, operationId: sharedActorId, assetId: sharedActorId };
  const blockedClient = () => { effects.push("admin"); throw new Error("Cliente privilegiado bloqueado."); };
  const terminal = (label: string, options: CapturedOptions) => {
    captured.set(label, options);
    return async (incoming: Request, incomingParams: unknown) => {
      assert.equal(incoming, request);
      assert.equal(incomingParams, /^(EXTRACTION|FRAGMENT)/.test(label) ? params.draftId : params);
      return Response.json({ handler: label });
    };
  };
  const modules: Record<string, unknown> = {
    [http + "composition-narrative-extraction-handler.server.ts"]: {
      createNarrativeExtractionHttpHandler: (mode: string, options: CapturedOptions) => terminal(`EXTRACTION:${mode}`, options),
    },
    [http + "composition-narrative-fragment-command-handler.server.ts"]: {
      createNarrativeFragmentCommandHttpHandler: (mode: string, options: CapturedOptions) => terminal(`FRAGMENT:${mode}`, options),
    },
    [http + "composition-narrative-fragment-plan-handler.server.ts"]: {
      createNarrativeFragmentPlanHttpHandler: (options: CapturedOptions) => terminal("FRAGMENT_PLAN", options),
    },
    [http + "composition-html-editing-reconstruction-resource-handlers.server.ts"]: {
      createHtmlReconstructionResourceHandlers: (options: CapturedOptions) => ({
        lookup: terminal("RECONSTRUCTION:lookup", options), read: terminal("RECONSTRUCTION:read", options), link: terminal("RECONSTRUCTION:link", options),
      }),
    },
    [http + "composition-html-editing-preview-page-handler.server.ts"]: {
      createHtmlPreviewPageHandler: (options: CapturedOptions) => terminal(`PREVIEW:${options.responseKind}`, options),
    },
    [http + "composition-html-editing-preview-resource-handler.server.ts"]: {
      createHtmlPreviewResourceHandler: (options: CapturedOptions) => terminal("RESOURCE", options),
    },
    [domain + "composition-html-editing-reconstruction-resource-link.contract.ts"]: resourcePolicy,
    [domain + "composition-html-editing-preview-configuration.server.ts"]: previewConfiguration,
    "src/lib/server/artifact-action-auth.ts": {
      getAuthenticatedUser: async () => { effects.push("identity"); if (state.identityFailure) throw state.identityFailure;
        return state.actorId ? { userId: state.actorId } : null; },
      canReviewContent: async (actorId: string, tenant: unknown) => {
        effects.push("review"); assert.equal(actorId, state.actorId); assert.equal(tenant, state.tenant);
        if (state.reviewFailure) throw state.reviewFailure; return state.reviewAllowed;
      }, getServiceRoleClient: blockedClient,
    },
    "src/lib/server/tenant-context.ts": { resolveActiveTenantContext: async () => {
      effects.push("tenant"); if (state.tenantFailure) throw state.tenantFailure; return state.tenant;
    } },
    "src/utils/supabase/server.ts": { createClient: async () => { effects.push("session"); return {}; } },
    "src/lib/server/env.ts": { getAppUrl: () => "https://engine.example" },
    "src/lib/server/operational-logger.ts": { createOperationalLogger: () => ({ warn: () => effects.push("log") }) },
  };
  for (const [name, exports] of Object.entries(HTML_ROUTE_POLICIES)) modules[canonical(name, entry.file)] = exports;
  const readModule = (filename: string): Record<string, unknown> => {
    const existing = cache.get(filename); if (existing) return existing;
    const imports: Record<string, unknown> = {};
    const syntax = ts.createSourceFile(filename, readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of syntax.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (specifier === "zod") { imports[specifier] = { z }; continue; }
      const target = canonical(specifier, filename);
      if (Object.hasOwn(modules, target)) { imports[specifier] = modules[target]; continue; }
      if (roots.has(target)) { imports[specifier] = readModule(target); continue; }
      const bindings = statement.importClause?.namedBindings;
      const blocked: Record<string, unknown> = {};
      if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
        const name = (binding.propertyName ?? binding.name).text;
        blocked[name] = () => { effects.push(`dominio:${name}`); throw new Error("Dominio bloqueado en composición."); };
      }
      imports[specifier] = blocked;
    }
    const exports = load<Record<string, unknown>>(filename, imports, { process: { env: environment, cwd: () => "runtime-sintetico" } });
    cache.set(filename, exports); return exports;
  };
  const handlers = readModule(entry.file) as Record<string, (request: Request, context: { params: Promise<unknown> }) => Promise<Response>>;
  const options = captured.get(entry.handler); assert.ok(options, `Falta factory terminal: ${entry.handler}`);
  return { state, environment, effects, options, handlers, request, params, blockedClient };
}
