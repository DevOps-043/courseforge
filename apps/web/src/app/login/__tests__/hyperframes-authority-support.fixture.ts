import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { z } from "zod";
import { NextResponse } from "next/server";
import { load } from "./source-test-loader";

export const id = "11111111-1111-4111-8111-111111111111";
export const hash = "a".repeat(64);
export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
export const version = load<typeof import("../../../domains/production/composition-editor/composition-document-version")>("src/domains/production/composition-editor/composition-document-version.ts");
const root = "src/app/api/production/hyperframes/";
const supportFiles = {
  preset: "_composition-preset-route-support.ts",
  agent: "drafts/[draftId]/agent-proposals/_route-support.ts",
  render: "renders/_render-route-support.ts",
} as const;
export type Family = keyof typeof supportFiles;
export type Gate = "identity" | "tenant" | "review";
interface RouteCase { file: string; family: Family; method: string; }
export const cases: RouteCase[] = [];
function discover(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { discover(file); continue; }
    if (entry.name !== "route.ts") continue;
    const source = readFileSync(file, "utf8");
    const family = source.includes("await authorizeCompositionPresetRequest(") ? "preset"
      : source.includes("await authorizeCompositionAgentRequest(") ? "agent"
      : source.includes("await resolveAuthorizedRenderContext(") ? "render" : null;
    if (!family) continue;
    for (const match of source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)) cases.push({ file: file.replaceAll("\\", "/"), family, method: match[1] });
  }
}
discover(root);
cases.sort((left, right) => `${left.file}/${left.method}`.localeCompare(`${right.file}/${right.method}`));

type Authorization = { response: Response | null; admin?: unknown; organizationId?: string; userId?: string };
type Support = Record<string, unknown>;
interface Options { gate?: Gate; failure?: unknown; deny?: Gate; }
export function fixture(options: Options = {}) {
  const effects: Array<{ kind: string; value?: unknown }> = [];
  const effect = (kind: string, value?: unknown) => effects.push({ kind, value });
  const gate = (name: Gate) => { effect(name); if (options.gate === name) throw options.failure; return options.deny !== name; };
  const admin = { cliente: "simulado" };
  const tenant = { organizationId: "organizacion-vigente", userId: "actor", platformRole: "admin" };
  const logger = { createOperationalLogger: () => ({
    error: (event: string, error: unknown) => effect("log.error", { event, message: String(error) }),
    warn: (event: string, fields?: unknown) => effect("log.warn", { event, fields }),
    info: (event: string, fields?: unknown) => effect("log.info", { event, fields }),
  }), resolveCorrelationId: () => "hyperframes-autoridad-test" };
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors,
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  const imports = {
    zod: { z }, "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "@/lib/server/authorization-unavailable-response": mapper,
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => gate("tenant") ? tenant : null },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => gate("identity") ? { userId: "actor" } : null,
      canReviewContent: async (userId: string, resolvedTenant: unknown) => { effect("review.input", { userId, tenant: resolvedTenant }); return gate("review"); },
      getServiceRoleClient: () => { effect("admin"); return admin; },
    },
    "@/domains/production/composition-editor/composition-document-version": version,
  };
  // Dominios no intervenidos: errores sintéticos y funciones bloqueadas. No se
  // atribuye cobertura de schemas/servicios a estos dobles; solo de autorización.
  class UnusedDomainError extends Error {}
  function dependencies(file: string): Record<string, unknown> {
    const modules: Record<string, unknown> = {};
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const names = statement.importClause?.namedBindings;
      const exports: Record<string, unknown> = {};
      if (names && ts.isNamedImports(names)) for (const element of names.elements) {
        const name = (element.propertyName || element.name).text;
        exports[name] = name.endsWith("Error") ? UnusedDomainError : function blocked(...args: unknown[]) {
          effect("dominio.bloqueado", { name, args }); throw new Error("Interacción de dominio no permitida en esta prueba.");
        };
      }
      modules[statement.moduleSpecifier.text] = exports;
    }
    return modules;
  }
  const supports = Object.fromEntries(Object.entries(supportFiles).map(([family, file]) => [family, load<Support>(root + file, { ...dependencies(root + file), ...imports })])) as Record<Family, Support>;
  const authorize = (family: Family): Promise<Authorization> => {
    const name = family === "preset" ? "authorizeCompositionPresetRequest" : family === "agent" ? "authorizeCompositionAgentRequest" : "resolveAuthorizedRenderContext";
    return (supports[family][name] as (requestId: string) => Promise<Authorization>)("hyperframes-autoridad-test");
  };
  const request = (entry: RouteCase) => {
    const bindings: Record<string, unknown> = { ...dependencies(entry.file), ...imports };
    for (const file of ts.preProcessFile(readFileSync(entry.file, "utf8")).importedFiles) {
      const name = file.fileName;
      if (name.endsWith("_composition-preset-route-support")) bindings[name] = supports.preset;
      if (name.endsWith("_render-route-support")) bindings[name] = supports.render;
      if (name.endsWith("/_route-support")) bindings[name] = supports.agent;
    }
    bindings["@/domains/production/composition-editor/composition-preset-store.service"] = {
      CompositionPresetStoreError: UnusedDomainError,
      listCompositionPresetCatalog: async (value: unknown) => { effect("catalogo", value); return []; },
    };
    bindings["@/domains/production/composition-editor/composition-agent-proposal-store.service"] = {
      ...(bindings["@/domains/production/composition-editor/composition-agent-proposal-store.service"] as object),
      dismissStoredCompositionAgentProposal: async (value: unknown) => { effect("descartar", value); },
    };
    bindings["@/domains/production/hyperframes/hyperframes-render-recovery.service"] = { HyperframesRenderRecoveryService: class {
      async findById(value: unknown) { effect("estado", value); return { id, status: "QUEUED" }; }
    } };
    const handlers = load<Record<string, (request: Request, context: unknown) => Promise<Response>>>(entry.file, bindings);
    return handlers[entry.method](new Request("https://local.test/api/production/hyperframes", {
      method: entry.method, headers: { "Content-Type": "application/json", "if-match": `"${hash}"` },
      ...(entry.method === "GET" ? {} : { body: "{}" }),
    }), { params: Promise.resolve({ draftId: id, proposalId: id, applicationId: id, requestId: id }) });
  };
  return { effects, admin, supports, authorize, request };
}
