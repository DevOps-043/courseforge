import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { load } from "./source-test-loader";
import { HTML_ROUTE_POLICIES } from "./hyperframes-html-route.policies";
import { HTML_ROUTE_CASES } from "./hyperframes-html-route.cases";

export type HtmlRouteCase = typeof HTML_ROUTE_CASES[number];
type Tenant = { userId: string; organizationId: string; platformRole: string };
type FactoryOptions = { enabled: (method: string) => boolean;
  authenticate: () => Promise<{ actorId: string | null; tenant: Tenant | null }>; serviceClient: () => unknown };
export function htmlRouteFixture(entry: HtmlRouteCase) {
  const effects: string[] = [];
  const environment: Record<string, string | undefined> = {};
  const state = { actorId: "actor-vigente" as string | null,
    tenant: { userId: "actor-vigente", organizationId: "empresa-vigente", platformRole: "ADMIN" } as Tenant | null,
    identityFailure: null as unknown, tenantFailure: null as unknown };
  const factories = new Map<string, FactoryOptions>();
  const imports: Record<string, unknown> = {};
  const syntax = ts.createSourceFile(entry.file, readFileSync(entry.file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of syntax.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    const moduleName = statement.moduleSpecifier.text;
    const exports: Record<string, unknown> = {};
    if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) {
      const name = (binding.propertyName ?? binding.name).text;
      exports[name] = moduleName.includes("/http/") && /^create\w+Handler$/.test(name)
        ? (options: FactoryOptions) => {
          factories.set(name, options);
          return async (request: Request, params: unknown) => {
            assert.equal(request, expectedRequest); assert.equal(params, expectedParams);
            return Response.json({ factory: name, module: moduleName });
          };
        }
        : () => { effects.push(`dominio:${name}`); throw new Error("Dominio bloqueado en prueba de composición."); };
    }
    imports[moduleName] = exports;
  }
  const blockedClient = () => { effects.push("admin"); throw new Error("Cliente privilegiado bloqueado."); };
  const expectedRequest = new Request("https://engine.example/composicion", { method: entry.method });
  const expectedParams = { draftId: "borrador-servidor", clipId: "clip", operationId: "operacion", candidateId: "candidato", revisionId: "revision" };
  const handlers = load<Record<string, (request: Request, context: { params: Promise<unknown> }) => Promise<Response>>>(entry.file, {
    ...imports, ...HTML_ROUTE_POLICIES,
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => { effects.push("identity"); if (state.identityFailure) throw state.identityFailure;
        return state.actorId ? { userId: state.actorId } : null; },
      getServiceRoleClient: blockedClient,
    },
    "@/lib/server/tenant-context": { resolveActiveTenantContext: async () => {
      effects.push("tenant"); if (state.tenantFailure) throw state.tenantFailure; return state.tenant;
    } },
    "@/utils/supabase/server": { createClient: async () => { effects.push("session"); return {}; } },
    "@/lib/server/operational-logger": { createOperationalLogger: () => ({ warn: () => effects.push("log") }) },
  }, { process: { env: environment } });
  const options = factories.get(entry.factory);
  assert.ok(options, `No se compuso la factory esperada: ${entry.factory}`);
  return { state, environment, effects, options, handlers, expectedRequest, expectedParams, blockedClient };
}

// Contratos de rollout: no se derivan de la implementación del callback enabled.
export function requiredHtmlRouteFlags(entry: HtmlRouteCase): string[] {
  const path = entry.file;
  const flags = (...suffixes: string[]) => suffixes.map(suffix => `COMPOSITION_HTML_${suffix}_ENABLED`);
  const inspector = "EDITING_INSPECTOR", initialization = "EDITING_INITIALIZATION", receipts = "EDITING_INITIALIZATION_RECEIPTS";
  if (path.includes("generated-deck-initialization/")) return flags(inspector, receipts,
    ...(!path.includes("/current/") && entry.method === "POST" ? [initialization] : []));
  if (path.includes("html-editing-initial-anchor/") || path.includes("/[clipId]/initialize/route.ts")) return flags(initialization);
  if (path.includes("/adopt/")) return flags(inspector, "EDITING_LEGACY_ADOPTION_RECEIPTS",
    ...(entry.method === "POST" ? ["EDITING_LEGACY_ADOPTION", "EDITING_MUTATIONS"] : []));
  if (path.includes("/initialize/operations/")) return flags(inspector, receipts, ...(entry.method === "POST" ? [initialization] : []));
  if (path.includes("/[clipId]/operations/")) return flags(inspector, "EDITING_OPERATION_RECEIPTS", ...(entry.method === "POST" ? ["EDITING_MUTATIONS"] : []));
  if (path.includes("/[clipId]/templates/")) return flags(inspector, initialization);
  if (path.includes("/[clipId]/route.ts")) return flags(inspector, ...(entry.method === "POST" ? ["EDITING_MUTATIONS"] : []));
  if (path.includes("html-historical-publications/")) return flags(inspector, "SNAPSHOT_RECOVERY",
    ...(entry.method === "POST" ? ["SNAPSHOT_PUBLICATION", "EDITING_MUTATIONS"] : []));
  if (path.includes("html-historical-candidates/") || path.includes("html-snapshot-history/")) return flags(inspector, "SNAPSHOT_RECOVERY");
  if (path.includes("html-legacy-inventory/")) return flags(inspector, "LEGACY_INVENTORY");
  if (path.includes("html-reconstruction-")) return flags(inspector, "RECONSTRUCTION_OPENING");
  if (path.includes("html-snapshots/")) return flags("SNAPSHOT_RECOVERY", ...(entry.method === "POST" ? ["SNAPSHOT_PUBLICATION"] : []));
  throw new Error(`Falta contrato de rollout: ${path}`);
}
