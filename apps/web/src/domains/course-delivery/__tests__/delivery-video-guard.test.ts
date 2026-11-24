import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { load } from "../../../app/login/__tests__/source-test-loader";

test("video final verifica recorrido antes de credenciales o despacho y permite el recurso vigente", async () => {
  const path = "src/app/api/production/heygen/videos/route.ts";
  const imports: Record<string, unknown> = {};
  // Las fronteras del handler se simulan; no se importan clientes de proveedor.
  for (const match of readFileSync(path, "utf8").matchAll(/from\s+"([^"]+)"/g)) imports[match[1]] = {};
  const calls: string[] = [];
  let permitted = false;
  imports["@/lib/server/operational-logger"] = { resolveCorrelationId: () => "request", createOperationalLogger: () => ({ error() {} }) };
  imports["@/lib/server/api-contract"] = { API_ERROR_CODE: { conflict: "CONFLICT" }, parseJsonRequest: async () => ({ success: true, data: { componentId: "component" } }) };
  imports["@/lib/server/api-response"] = { apiErrorResponse: (input: { status: number }) => Response.json(input, { status: input.status }), apiSuccessResponse: (input: unknown, options: { status: number }) => Response.json(input, options) };
  imports["@/utils/supabase/server"] = { createClient: async () => ({}) };
  imports["@/lib/server/artifact-action-auth"] = { getAuthenticatedUser: async () => ({ userId: "user" }), canReviewContent: async () => true, getAuthorizedMaterialComponentAdmin: async () => ({ admin: {} }) };
  imports["@/lib/server/tenant-context"] = { resolveActiveTenantContext: async () => ({ organizationId: "org" }) };
  imports["@/domains/production/jobs/production-jobs.service"] = { resolveProductionComponentContext: async () => { calls.push("scope"); if (!permitted) throw new Error("Exclusivo de Hub"); } };
  imports["@/domains/production/providers/heygen/heygen-credential-resolver.service"] = { getHeygenClientForOrganization: async () => { calls.push("provider"); } };
  imports["@/lib/server/background-function-client"] = { callBackgroundFunctionJson: async () => { calls.push("dispatch"); } };
  imports["@/lib/server/background-payload-signature"] = { signBackgroundPayload: (value: unknown) => value };
  const route = load<{ POST: (request: Request) => Promise<Response> }>(path, imports);
  const request = () => new Request("https://example.test/api/video", { method: "POST" });
  assert.equal((await route.POST(request())).status, 409);
  assert.deepEqual(calls, ["scope"]);
  permitted = true; calls.length = 0;
  assert.equal((await route.POST(request())).status, 202);
  assert.deepEqual(calls, ["scope", "provider", "dispatch"]);
});
