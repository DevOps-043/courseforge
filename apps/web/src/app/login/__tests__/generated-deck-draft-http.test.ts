import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { load } from "./source-test-loader";

test("el borrador distingue rechazo de integridad, dependencia no disponible y fuente pendiente sin filtrar URLs", async () => {
  const path = "src/app/api/production/hyperframes/compositions/[compositionId]/draft/route.ts";
  const imports: Record<string, unknown> = {};
  for (const match of readFileSync(path, "utf8").matchAll(/from\s+"([^"]+)"/g)) imports[match[1]] = {};
  class GeneratedDeckReadError extends Error { constructor(public code: string) { super("PRIVATE_DIAGNOSTIC_URL"); } }
  class OtherError extends Error {}
  let code = "INTEGRITY_MISMATCH";
  imports["@/lib/server/authorization-unavailable-response"] = { authorizationUnavailableResponse: () => null };
  imports["@/lib/server/artifact-action-auth"] = { getAuthenticatedUser: async () => ({ userId: "user" }), canReviewContent: async () => true, getServiceRoleClient: () => ({}) };
  imports["@/lib/server/tenant-context"] = { resolveActiveTenantContext: async () => ({ organizationId: "org" }), TenantContextLookupError: OtherError };
  imports["@/domains/production/hyperframes/hyperframes-draft.service"] = { HyperframesDraftError: OtherError, initializeHyperframesDraft: async () => { throw new GeneratedDeckReadError(code); } };
  imports["@/domains/production/slides/generation/course-deck-editorial-reader.server"] = { GeneratedDeckReadError };
  imports["@/domains/production/hyperframes/hyperframes-request-validation"] = { validateHyperframesCompositionId: () => ({ success: true, data: "composition" }) };
  imports["@/domains/production/composition-editor/composition-document.service"] = { CompositionDocumentError: OtherError };
  imports["@/utils/supabase/server"] = { createClient: async () => ({}) };
  imports["@/lib/server/api-contract"] = { API_ERROR_CODE: { dependencyUnavailable: "DEPENDENCY_UNAVAILABLE", invalidRequest: "INVALID_REQUEST" } };
  imports["@/lib/server/api-response"] = { apiErrorResponse: (input: { status: number }) => Response.json(input, { status: input.status }) };
  imports["@/lib/server/operational-logger"] = { resolveCorrelationId: () => "request-id", createOperationalLogger: () => ({ warn() {}, error() {} }) };
  imports.zod = { z: { ZodError: OtherError } };
  const route = load<{ POST: (request: Request, context: object) => Promise<Response> }>(path, imports);
  for (const current of ["INTEGRITY_MISMATCH", "UNAVAILABLE", "FONT_BINDING_REQUIRED"]) {
    code = current;
    const response = await route.POST(new Request("https://example.test/api/draft", { method: "POST" }), { params: Promise.resolve({ compositionId: "composition" }) });
    const body = await response.json();
    assert.equal(response.status, current === "UNAVAILABLE" ? 503 : 422);
    assert.equal(body.retryable, current === "UNAVAILABLE");
    assert.equal(body.details.reason, `GENERATED_DECK_${current}`);
    assert.equal(body.requestId, "request-id");
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_DIAGNOSTIC_URL/);
  }
});
