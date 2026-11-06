import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { NextResponse } from "next/server";
import { load } from "./source-test-loader";
import * as performanceContract from "../../../domains/production/composition-editor/composition-preview-performance";
import * as comparison from "../../../domains/production/composition-editor/composition-preview-comparison";
import * as bridge from "../../../domains/production/composition-editor/composition-preview-failure-bridge";
import * as narrativeContract from "../../../domains/production/composition-editor/composition-narrative-extraction-contract";
import { DIRECT_HTTP_CASES } from "./hyperframes-direct-authority.cases";

export const id = "11111111-1111-4111-8111-111111111111";
export const hash = "a".repeat(64);
export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
export const cases = [...DIRECT_HTTP_CASES];
export type DirectCase = typeof cases[number];
export type Stage = "identity" | "tenant" | "review";
const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
class ProbeComplete extends Error {}
interface Options { stage?: Stage; failure?: unknown; deny?: Stage; probe?: boolean; }
export function fixture(entry: DirectCase, options: Options = {}) {
  const effects: Array<{ kind: string; value?: unknown }> = [];
  const effect = (kind: string, value?: unknown) => effects.push({ kind, value });
  const stage = (name: Stage) => { effect(name); if (options.stage === name) throw options.failure; return options.deny !== name; };
  const tenant = { organizationId: "organizacion-vigente", userId: "actor", platformRole: "admin" };
  const logger = { createOperationalLogger: () => ({
    error: (event: string, error: unknown) => effect("log.error", { event, message: String(error) }),
    warn: (event: string, fields: unknown) => effect("log.warn", { event, fields }),
    info: (event: string, fields: unknown) => effect("log.info", { event, fields }),
  }), resolveCorrelationId: () => "directa-autoridad-test" };
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors,
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  const dependencies: Record<string, unknown> = {};
  class UnusedDomainError extends Error {}
  const syntax = ts.createSourceFile(entry.file, readFileSync(entry.file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of syntax.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const names = statement.importClause?.namedBindings;
    const exports: Record<string, unknown> = {};
    if (names && ts.isNamedImports(names)) for (const element of names.elements) {
      const name = (element.propertyName || element.name).text;
      exports[name] = name.endsWith("Error") ? UnusedDomainError : function blocked() { effect("dominio", name); throw new Error("Dominio bloqueado en prueba de autorización."); };
    }
    dependencies[statement.moduleSpecifier.text] = exports;
  }
  const handlers = load<Record<string, (request: Request, context: unknown) => Promise<Response>>>(entry.file, {
    ...dependencies, zod: { z }, "next/server": { NextResponse },
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "@/lib/server/authorization-unavailable-response": mapper,
    "@/utils/supabase/server": { createClient: async () => ({}) },
    "@/lib/server/tenant-context": { ...tenantErrors, resolveActiveTenantContext: async () => stage("tenant") ? tenant : null },
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => stage("identity") ? { userId: "actor" } : null,
      canReviewContent: async (userId: string, resolvedTenant: unknown) => { effect("review.input", { userId, tenant: resolvedTenant }); return stage("review"); },
      getServiceRoleClient: () => { effect("admin"); if (options.probe) throw new ProbeComplete(); throw new Error("Cliente privilegiado bloqueado en prueba."); },
    },
    "@/domains/production/composition-editor/composition-preview-performance": performanceContract,
    "@/domains/production/composition-editor/composition-preview-comparison": comparison,
    "@/domains/production/composition-editor/composition-preview-failure-bridge": bridge,
    "@/domains/production/composition-editor/composition-narrative-extraction-contract": narrativeContract,
  }, { performance, AbortSignal });
  const request = (query = "", body?: unknown) => {
    const defaultBody = entry.file.endsWith("final-video/route.ts") ? { assetId: id }
      : entry.file.endsWith("detach-audio/route.ts") ? { componentId: id, durationSeconds: 1, fileName: "audio.wav", sourceAssetId: id, sourceClipId: "clip", storagePath: `editor-audio/${id}/audio.wav` }
      : entry.file.endsWith("compositions/[compositionId]/revisions/route.ts") && entry.method === "POST" ? { generationMode: "AUTOMATIC" }
      : entry.file.endsWith("assets/sync/route.ts") || entry.file.endsWith("hyperframes/compositions/route.ts") ? { componentId: id } : {};
    return handlers[entry.method](new Request(`https://local.test/?componentId=${id}&${query}`, {
      method: entry.method, headers: { "Content-Type": "application/json", "if-match": `"${hash}"` },
      ...(entry.method === "GET" ? {} : { body: JSON.stringify(body ?? defaultBody) }),
    }), { params: Promise.resolve({ compositionId: id, revisionId: id, draftId: id, assetId: id, path: ["index.html"] }) });
  };
  return { effects, request };
}
