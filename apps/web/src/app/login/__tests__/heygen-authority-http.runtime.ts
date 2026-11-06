import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import ts from "typescript";
import { load } from "./source-test-loader";
export * as validators from "../../../domains/production/providers/heygen/heygen.validators";
export * as platformValidators from "../../../domains/production/providers/heygen/heygen-platform.validators";
export * as productionTypes from "../../../domains/production/types/production.types";

// Solo se usan declaraciones de error; todas sus dependencias externas quedan bloqueadas.
function isolated<T>(file: string): T {
  const imports = Object.fromEntries(ts.preProcessFile(readFileSync(file, "utf8")).importedFiles.map(({ fileName }) => [fileName, {}]));
  return load<T>(file, imports);
}
const providerRoot = "src/domains/production/providers/heygen/";
export const heygenApi = isolated<typeof import("../../../domains/production/providers/heygen/heygen.client")>(providerRoot + "heygen.client.ts");
export const credentials = isolated<typeof import("../../../domains/production/providers/heygen/heygen-credential-resolver.service")>(providerRoot + "heygen-credential-resolver.service.ts");
export const video = isolated<typeof import("../../../domains/production/providers/heygen/heygen-video.service")>(providerRoot + "heygen-video.service.ts");
export const scenes = isolated<typeof import("../../../domains/production/providers/heygen/heygen-scenes.service")>(providerRoot + "heygen-scenes.service.ts");
export const platform = isolated<typeof import("../../../domains/production/providers/heygen/heygen-platform.service")>(providerRoot + "heygen-platform.service.ts");
export const catalog = isolated<typeof import("../../../domains/production/providers/heygen/heygen-catalog.service")>(providerRoot + "heygen-catalog.service.ts");
export const constraints = load<typeof import("../../../domains/production/providers/heygen/heygen-request-constraints")>(providerRoot + "heygen-request-constraints.ts");
export const identityErrors = load<typeof import("../../../lib/server/auth-identity-error")>("src/lib/server/auth-identity-error.ts");
export const tenantErrors = load<typeof import("../../../lib/server/tenant-context-error")>("src/lib/server/tenant-context-error.ts");
export const contract = load("src/lib/server/api-contract.ts");
const responses = load("src/lib/server/api-response.ts", { "next/server": { NextResponse }, "./api-contract": contract });
export interface TestLog { level: string; event: string; fields: unknown; }
export function httpRuntime(logs: TestLog[]) {
  const logger = { createOperationalLogger: () => ({
    error: (event: string, error: unknown) => logs.push({ level: "error", event, fields: String(error) }),
    warn: (event: string, fields: unknown) => logs.push({ level: "warn", event, fields }),
    info: (event: string, fields: unknown) => logs.push({ level: "info", event, fields }),
  }), resolveCorrelationId: () => "heygen-autoridad-test" };
  const mapper = load("src/lib/server/authorization-unavailable-response.ts", {
    "./auth-identity-error": identityErrors, "./tenant-context-error": tenantErrors,
    "./api-contract": contract, "./api-response": responses, "./operational-logger": logger,
  });
  return {
    "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    "@/lib/server/operational-logger": logger, "@/lib/server/authorization-unavailable-response": mapper,
    "@/lib/server/heygen-route-response": load("src/lib/server/heygen-route-response.ts", {
      "@/lib/server/api-contract": contract, "@/lib/server/api-response": responses,
    }),
  };
}
