import assert from "node:assert/strict";
import { test } from "node:test";
import { cases, fixture, identityErrors, tenantErrors, hash, id, version, type Family } from "./hyperframes-authority-support.fixture";

test("inventario actual de los tres soportes compartidos", () => {
  assert.equal(new Set(cases.map(entry => entry.file)).size, 16);
  assert.equal(cases.length, 18);
});
for (const entry of cases) {
  const label = `${entry.method} ${entry.file.split("hyperframes/")[1]}`;
  test(`${label}: 503 seguro detiene todas las operaciones posteriores`, async () => {
    for (const gate of ["identity", "tenant", "review"] as const) for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
      const context = fixture({ gate, failure: Object.assign(new Failure(), { message: "CANARIO_PRIVADO" }) });
      const response = await context.request(entry); const body = await response.json();
      assert.equal(response.status, 503, `${gate}/${Failure.name}`); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE");
      assert.equal(body.retryable, true); assert.equal(body.requestId, "hyperframes-autoridad-test");
      assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary") || "", /Cookie/);
      assert.doesNotMatch(JSON.stringify([body, context.effects.filter(effect => effect.kind.startsWith("log."))]), /CANARIO_PRIVADO/);
      const failureIndex = context.effects.findIndex(effect => effect.kind === gate); assert.ok(failureIndex >= 0);
      assert.equal(context.effects.slice(failureIndex + 1).filter(effect => !effect.kind.startsWith("log.")).length, 0);
    }
  });
  test(`${label}: 401/403 no crean admin ni invocan dominios`, async () => {
    for (const deny of ["identity", "tenant", "review"] as const) {
      const context = fixture({ deny }); assert.equal((await context.request(entry)).status, deny === "identity" ? 401 : 403);
      assert.equal(context.effects.filter(effect => ["admin", "dominio.bloqueado", "catalogo", "descartar", "estado"].includes(effect.kind)).length, 0);
    }
  });
}
for (const family of ["preset", "agent", "render"] as const) {
  test(`${family}: contexto positivo conserva contrato y ancla revisión al tenant`, async () => {
    const context = fixture(); const auth = await context.authorize(family);
    assert.equal(auth.response, null); assert.equal(auth.admin, context.admin); assert.equal(auth.organizationId, "organizacion-vigente");
    if (family !== "render") assert.equal(auth.userId, "actor");
    const review = context.effects.find(effect => effect.kind === "review.input")?.value as { userId: string; tenant: { organizationId: string } };
    assert.equal(review.userId, "actor"); assert.equal(review.tenant.organizationId, auth.organizationId);
  });
  test(`${family}: errores desconocidos se relanzan sin convertir metadata impostora`, async () => {
    const impostor = Object.assign(new Error("Error ordinario"), { name: "TenantContextLookupError", code: "TENANT_LOOKUP_UNAVAILABLE" });
    const context = fixture({ gate: "identity", failure: impostor });
    await assert.rejects(context.authorize(family), error => error === impostor);
    assert.equal(context.effects.filter(effect => effect.kind === "admin").length, 0);
  });
}
const representatives: Array<[Family, string, string, string]> = [
  ["preset", "composition-presets/route.ts", "GET", "catalogo"],
  ["agent", "agent-proposals/[proposalId]/route.ts", "DELETE", "descartar"],
  ["render", "renders/[requestId]/poll/route.ts", "GET", "estado"],
];
for (const [family, suffix, method, effect] of representatives) {
  test(`${family}: representante HTTP válido propaga organización y DTO`, async () => {
    const entry = cases.find(entry => entry.file.endsWith(suffix) && entry.method === method); assert.ok(entry);
    const context = fixture(); const response = await context.request(entry); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.success, true);
    const value = context.effects.find(entry => entry.kind === effect)?.value as { organizationId: string; draftId?: string };
    assert.equal(value.organizationId, "organizacion-vigente"); if (family === "agent") assert.equal(value.draftId, id);
    if (family === "preset") assert.deepEqual(body.data, []);
    if (family === "render") assert.equal(body.data.status, "QUEUED");
  });
}
test("presets: precondiciones reales conservan 428 y aceptan hash/ETag coherentes", async () => {
  const context = fixture();
  const resolve = context.supports.preset.resolveCompositionPresetMutationPrecondition as (value: { documentId: string; operation: string; request: Request; requestId: string }) => { ok: boolean; response?: Response; documentHash?: string };
  const headerCases: HeadersInit[] = [{}, { "if-match": 'W/"inválido"' }, { "if-match": `"${hash}"`, [version.COMPOSITION_VERSION_FALLBACK_HEADER]: "b".repeat(64) }];
  for (const headers of headerCases) {
    const result = resolve({ documentId: id, operation: "APPLY", request: new Request("https://local.test", { headers }), requestId: "prueba" });
    assert.equal(result.ok, false); assert.equal(result.response?.status, 428);
  }
  const result = resolve({ documentId: id, operation: "UNDO", request: new Request("https://local.test", { headers: { "if-match": `"${hash}"` } }), requestId: "prueba" });
  assert.equal(result.ok, true); assert.equal(result.documentHash, hash);
  const preview = context.supports.preset.COMPOSITION_PRESET_PREVIEW_HEADERS as Record<string, string>;
  assert.equal(preview["Cache-Control"], "private, no-store"); assert.equal(preview["X-Content-Type-Options"], "nosniff");
  assert.match(preview["Content-Security-Policy"], /connect-src 'none'/);
});
