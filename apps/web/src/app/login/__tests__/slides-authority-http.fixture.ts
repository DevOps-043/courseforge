import { readFileSync } from "node:fs";
import * as nodeCrypto from "node:crypto";
import { NextResponse } from "next/server";
import ts from "typescript";
import { z } from "zod";
import { load } from "./source-test-loader";
import * as deckSchemas from "../../../domains/production/slides/specs/course-deck.schema";
import * as designContract from "../../../domains/production/slides/import/imported-slide-design.contract";
import * as assetSchemas from "../../../domains/materials/validators/assets.validators";
import * as productionTypes from "../../../domains/production/types/production.types";
import * as htmlSourceAccess from "../../../domains/production/validation/slide-html-source-access";

export const componentId = "11111111-1111-4111-8111-111111111111";
export const otherComponentId = "22222222-2222-4222-8222-222222222222";
export const htmlPath = `slides/${componentId}-slides-source.html`;
export const runId = "33333333-3333-4333-8333-333333333333";
export const jobId = "44444444-4444-4444-8444-444444444444";
export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
export const routes = ["slides/templates/[runId]/preview", "slides/html-preview", "slides/jobs", "slides/appearance", "slides/generate", "slides/animated-deck/prepare", "open-design/export", "open-design/html-to-png"] as const;
export type RouteName = typeof routes[number];
export type Gate = "identity" | "review" | "component" | "tenant" | "context";
type Handler = (request: Request, context: { params: Promise<{ runId: string }> }) => Promise<Response>;

function isolated<T>(file: string, overrides: Record<string, unknown> = {}): T {
  const imports = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles.map(({ fileName }) => [fileName, {}]));
  return load<T>(file, { ...imports, ...overrides });
}
export const authErrors = isolated<typeof import("../../../lib/server/artifact-action-auth")>("src/lib/server/artifact-action-auth.ts");
const rasterizer = isolated<typeof import("../../../domains/production/validation/open-design-html-rasterizer.service")>("src/domains/production/validation/open-design-html-rasterizer.service.ts");
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });

export interface Options {
  gate?: Gate; failure?: unknown; deny?: Gate; missingHtml?: boolean; registeredPath?: string;
  downloadFailure?: boolean; queryFailure?: boolean; missingRun?: boolean; badDesign?: boolean;
  jobStatus?: string; dispatchFailure?: unknown; prepareFailure?: unknown; persistFailure?: boolean;
  signedActor?: { componentId: string; createdBy: string; organizationId: string };
  internalOrganization?: string; editorialContext?: boolean;
}
export function fixture(route: RouteName, options: Options = {}) {
  const effects: Array<{ kind: string; value?: unknown }> = [];
  const effect = (kind: string, value?: unknown) => { effects.push({ kind, value }); };
  const gate = (name: Gate) => { effect(name); if (options.gate === name) throw options.failure; return options.deny !== name; };
  const logger = { createOperationalLogger: () => ({
    error: (event: string, error: unknown) => effect("log.error", { event, message: String(error) }),
    warn: (event: string, fields: unknown) => effect("log.warn", { event, fields }),
    info: (event: string, fields: unknown) => effect("log.info", { event, fields }),
  }), resolveCorrelationId: () => "slides-autoridad-test" };
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors,
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  const html = '<html data-appearance="light"><!-- soflia-appearance-variables:v1 --><body>Contenido</body></html>';
  const assets = options.missingHtml ? {} : { slides: { html_content_path: options.registeredPath || `production-assets/${htmlPath}`,
    ...(options.editorialContext ? { editable_deck: {}, prepared_spec: {} } : {}) } };
  const component = { id: componentId, assets, content: {}, material_lessons: { materials: { artifact_id: "artifact" } } };
  const admin = {
    from: (table: string) => {
      effect("query", table);
      const query = {
        select: () => query, order: () => query, limit: () => query,
        eq: (column: string, value: unknown) => { effect("filter", { table, column, value }); return query; },
        gte: (column: string, value: unknown) => { effect("gte", { column, value }); return query; },
        update: (value: unknown) => { effect("update", value); return query; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
        maybeSingle: async () => ({ data: table === "production_jobs" ? { id: jobId, status: "RUNNING" }
          : table === "material_components" ? component
          : table === "artifacts" ? { organization_id: options.internalOrganization || "organizacion" }
          : table === "soflia_bundle_generation_runs" ? (options.missingRun ? null : { spec_id: "spec" })
          : { spec_json: { importedDesign: {} } }, error: options.queryFailure ? new Error("consulta fallida") : null }),
        single: async () => ({ data: component, error: null }),
      };
      return query;
    },
    storage: { from: (bucket: string) => ({
      download: async (path: string) => { effect("download", { bucket, path }); return { data: options.downloadFailure ? null : new Blob([html]), error: null }; },
      upload: async (path: string, bytes: unknown, settings: unknown) => { effect("upload", { bucket, path, bytes, settings }); return { error: null }; },
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://assets.test/${path}` } }),
    }) },
    rpc: async (name: string, value: { p_assets_patch: unknown }) => { effect("rpc", { name, ...value }); return { data: value.p_assets_patch, error: options.persistFailure ? new Error("persistencia fallida") : null }; },
  };
  const auth = {
    MaterialComponentLookupUnavailableError: authErrors.MaterialComponentLookupUnavailableError,
    getAuthenticatedUser: async () => gate("identity") ? { userId: "actor" } : null,
    canReviewContent: async () => gate("review"),
    getAuthorizedMaterialComponentAdmin: async (id: string) => gate("component") ? (effect("authorized.id", id), { admin, component, artifactId: "artifact" }) : null,
    getServiceRoleClient: () => { effect("admin"); return admin; },
  };
  const tenant = { resolveActiveTenantContext: async () => gate("tenant") ? { organizationId: "organizacion", userId: "actor", platformRole: "admin" } : null };
  const bundleContext = load("src/domains/production/bundle-agent/route-context.ts", {
    "@/lib/server/artifact-action-auth": auth, "@/lib/server/tenant-context": tenant,
    "@/utils/supabase/server": { createClient: async () => ({}) },
  });
  const bundleErrors = isolated("src/domains/production/bundle-agent/route-contract.ts", {
    zod: { z }, "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "./redaction.service": { sanitizeErrorMessage: (error: unknown) => error instanceof Error ? error.message : "Error" },
    "../slides/import/imported-slide-design.contract": designContract,
  });
  const imports: Record<string, unknown> = {
    zod: { z }, "../../../../../config/app": { APP_CONFIG: { name: "SofLIA" } },
    "../../../../../config/branding-html": { escapeBrandingHtml: (value: string) => value },
    "node:crypto": nodeCrypto,
    "@/lib/server/artifact-action-auth": auth, "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "@/lib/server/authorization-unavailable-response": mapper,
    "@/domains/production/bundle-agent/route-context": bundleContext,
    "@/domains/production/bundle-agent/route-contract": bundleErrors,
    "@/domains/production/slides/import/imported-slide-design.contract": designContract,
    "@/domains/production/slides/import/imported-slide-design.service": {
      normalizeImportedSlideDesign: () => { effect("normalize.design"); if (options.badDesign) throw new designContract.HtmlSlideImportError("Diseño inválido."); return {}; },
      importedDesignPreview: () => { effect("preview"); return "<html>Plantilla</html>"; },
    },
    "@/domains/production/slides/import/imported-slide-bundle-assets.server": { hydrateImportedDesignForOrganization: async (design: unknown, context: unknown) => { effect("hydrate", context); return design; } },
    "@/domains/materials/validators/assets.validators": assetSchemas,
    "@/domains/production/types/production.types": productionTypes,
    "@/domains/production/validation/slide-html-source-access": htmlSourceAccess,
    "@/domains/production/slides/specs/course-deck.schema": options.editorialContext ? { ...deckSchemas, courseDeckSpecSchema: { safeParse: () => ({ success: true, data: {} }) } } : deckSchemas,
    "@/domains/production/validation/open-design-html-rasterizer.service": {
      normalizeProductionAssetStoragePath: rasterizer.normalizeProductionAssetStoragePath,
      rasterizeStoredOpenDesignHtmlSlides: async (value: unknown) => { effect("rasterize", value); return { images: [{ public_url: "https://assets.test/slide.png" }], cleanup: { slideCount: 1 } }; },
    },
    "@/domains/production/validation/animated-deck-preprocessor.service": {
      collectAnimatedDeckRemoteAssetUrls: () => [], rewriteAnimatedDeckRemoteAssetUrls: (value: string) => value,
      prepareAnimatedDeckForRemotion: () => { effect("prepare"); if (options.prepareFailure) throw options.prepareFailure;
        return { deck: { appearance: "light", width: 1920, height: 1080, slides: [{}] }, animatedSlideCount: 0, staticSlideCount: 1, cleanup: {}, css: "", fonts: [], remoteAssets: [], validation: { isValid: true } }; },
    },
    "@/domains/production/jobs/production-jobs.service": {
      resolveProductionComponentContext: async (value: unknown) => { gate("context"); effect("context.input", value); return { organizationId: "organizacion" }; },
      buildProductionIdempotencyKey: (value: unknown) => { effect("idempotency", value); return "idem"; },
      createOrReuseProductionJob: async (_: unknown, value: unknown) => { effect("job", value); return { id: jobId, status: options.jobStatus || "FAILED" }; },
      failProductionJob: async (value: unknown) => { effect("compensate", value); },
    },
    "@/lib/server/background-payload-signature": {
      signBackgroundPayload: (value: unknown) => { effect("sign", value); return { signed: value }; },
      verifyBackgroundPayload: () => { effect("verify"); if (!options.signedActor) throw new Error("Firma inválida"); return options.signedActor; },
    },
    "@/lib/server/background-function-client": { dispatchBackgroundFunctionJson: async (...value: unknown[]) => { effect("dispatch", value.slice(0, 2)); if (options.dispatchFailure) throw options.dispatchFailure; } },
    sharp: { default: () => ({ resize: () => ({ png: () => ({ toBuffer: async () => Buffer.from("png-simulado") }) }) }) },
  };
  const handlers = isolated<Record<string, Handler>>(`src/app/api/production/${route}/route.ts`, imports);
  const method = route.endsWith("preview") || route === "slides/jobs" ? "GET" : route === "slides/appearance" ? "PATCH" : "POST";
  const request = (overrides: { body?: unknown; rawBody?: string; query?: string; headers?: Record<string, string>; param?: string } = {}) => {
    const query = overrides.query ?? (route === "slides/html-preview" ? `path=${htmlPath}` : route === "slides/jobs" ? `componentId=${componentId}` : "");
    const body = overrides.rawBody ?? JSON.stringify(overrides.body ?? { componentId, ...(route === "slides/appearance" ? { appearance: "dark" } : {}) });
    return handlers[method](new Request(`https://local.test/api/production/${route}?${query}`, {
      method, headers: { "Content-Type": "application/json", ...overrides.headers }, ...(method === "GET" ? {} : { body }),
    }), { params: Promise.resolve({ runId: overrides.param || runId }) });
  };
  return { request, effects };
}
