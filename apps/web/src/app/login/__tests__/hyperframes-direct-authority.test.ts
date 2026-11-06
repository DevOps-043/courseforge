import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { cases, fixture, hash, identityErrors, tenantErrors } from "./hyperframes-direct-authority.fixture";

test("inventario directo de 17 rutas y 24 métodos", () => {
  assert.equal(new Set(cases.map(entry => entry.file)).size, 17); assert.equal(cases.length, 24);
  for (const file of new Set(cases.map(entry => entry.file))) {
    const methods = [...readFileSync(file, "utf8").matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map(match => match[1]).sort();
    assert.deepEqual(methods, cases.filter(entry => entry.file === file).map(entry => entry.method).sort());
  }
});
for (const entry of cases) {
  const label = `${entry.method} ${entry.file.split("hyperframes/")[1]}`;
  test(`${label}: ambas clases no exponen detalles ni permiten efectos posteriores`, async () => {
    for (const stage of ["identity", "tenant", "review"] as const) for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
      const context = fixture(entry, { stage, failure: Object.assign(new Failure(), { message: "CANARIO_PRIVADO" }) });
      const response = await context.request(); const body = await response.json();
      assert.equal(response.status, 503, `${stage}/${Failure.name}`); assert.equal(body.code, "DEPENDENCY_UNAVAILABLE"); assert.equal(body.retryable, true);
      assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.match(response.headers.get("vary") || "", /Cookie/);
      assert.equal(body.requestId, "directa-autoridad-test"); assert.doesNotMatch(JSON.stringify([body, context.effects.filter(effect => effect.kind.startsWith("log."))]), /CANARIO_PRIVADO/);
      if (entry.legacyReason && Failure === tenantErrors.TenantContextLookupError) assert.equal(body.details.reason, "TENANT_LOOKUP_UNAVAILABLE");
      const index = context.effects.findIndex(effect => effect.kind === stage); assert.ok(index >= 0);
      assert.equal(context.effects.slice(index + 1).filter(effect => !effect.kind.startsWith("log.")).length, 0);
    }
  });
  test(`${label}: conserva denegaciones y revisión ligada al tenant antes de admin`, async () => {
    for (const deny of ["identity", "tenant", "review"] as const) {
      const context = fixture(entry, { deny }); assert.equal((await context.request()).status, deny === "identity" ? 401 : 403);
      assert.equal(context.effects.filter(effect => ["admin", "dominio"].includes(effect.kind)).length, 0);
    }
    const context = fixture(entry, { probe: true }); await context.request();
    assert.equal(context.effects.filter(effect => effect.kind === "admin").length, 1);
    const review = context.effects.find(effect => effect.kind === "review.input")?.value as { userId: string; tenant: { organizationId: string } };
    assert.equal(review.userId, "actor"); assert.equal(review.tenant.organizationId, "organizacion-vigente");
    assert.equal(context.effects.filter(effect => effect.kind === "dominio").length, 0);
  });
}
test("preview nativo: fallo de autoridad conserva bridge HTML de sync v2", async () => {
  const entry = cases.find(entry => entry.file.endsWith("drafts/[draftId]/preview/route.ts")); assert.ok(entry);
  for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
    const context = fixture(entry, { stage: "identity", failure: Object.assign(new Failure(), { message: "CANARIO_PRIVADO" }) });
    const response = await context.request(`sync=2&r=3&documentHash=${hash}`);
    assert.equal(response.status, 503); assert.match(response.headers.get("content-type") || "", /text\/html/);
    assert.match(response.headers.get("vary") || "", /Cookie/);
    assert.ok(response.headers.get("content-security-policy")); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const html = await response.text(); assert.match(html, /DEPENDENCY_FAILED/); assert.match(html, new RegExp(hash)); assert.doesNotMatch(html, /CANARIO_PRIVADO/);
  }
});
