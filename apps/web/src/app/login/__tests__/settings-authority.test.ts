import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthIdentityLookupError } from "../../../lib/server/auth-identity-error";
import { TenantContextLookupError } from "../../../lib/server/tenant-context-error";
import { SETTINGS_ACTION_CASES, settingsFixture, settingsOrganization, foreignSettingsOrganization } from "./settings-authority.fixture";

for (const entry of SETTINGS_ACTION_CASES) {
  test(`ajustes ${entry.name} niega tenant ausente, ajeno o inválido sin privilegios`, async () => {
    for (const kind of ["missing", "actor", "invalid"] as const) {
      const f = settingsFixture();
      if (kind === "missing") f.state.tenant = null;
      else if (kind === "actor") f.state.tenant!.userId = foreignSettingsOrganization;
      else f.state.tenant!.organizationId = "organizacion-invalida";
      const result = await f.actions[entry.name]!(...entry.args);
      assert.equal(result.success, false);
      assert.equal(f.effects.includes("admin"), false); assert.equal(f.effects.includes("cookie"), false);
      assert.equal(f.queries.length, 0);
    }
  });
  test(`ajustes ${entry.name} serializa error de identidad y tenant sin efectos`, async () => {
    for (const stage of ["identity", "tenant"] as const) for (const failure of [new AuthIdentityLookupError(), new TenantContextLookupError()]) {
      const f = settingsFixture(); failure.message = "CANARIO_PRIVADO_AUTORIDAD";
      if (stage === "identity") f.state.identityFailure = failure; else f.state.tenantFailure = failure;
      const result = await f.actions[entry.name]!(...entry.args);
      assert.equal(result.success, false); assert.equal(result.errorCode, "DEPENDENCY_UNAVAILABLE"); assert.equal(result.retryable, true);
      assert.doesNotMatch(JSON.stringify(result), /CANARIO_PRIVADO/);
      assert.equal(f.effects.includes("admin"), false); assert.equal(f.effects.includes("cookie"), false);
      assert.equal(f.queries.length, 0);
    }
  });
  test(`ajustes ${entry.name} usa solo contexto vigente y scope permitido`, async () => {
    const f = settingsFixture(); const result = await f.actions[entry.name]!(...entry.args);
    assert.equal(result.success, true);
    assert.equal(f.effects.filter(effect => effect === "tenant").length, 1);
    assert.equal(f.effects.includes("cookie"), false); assert.equal(f.queries.some(query => query.table === "profiles"), false);
    const orgQueries = f.queries.filter(query => query.filters.some(([, field]) => field === "organization_id"));
    assert.ok(orgQueries.length > 0);
    for (const query of orgQueries) for (const [method, field, value] of query.filters) {
      if (method === "eq" && field === "organization_id") assert.equal(value, settingsOrganization);
    }
    for (const query of f.queries.filter(query => query.operation !== "select")) {
      if (query.operation === "insert") assert.equal(query.payload?.organization_id, settingsOrganization);
      else assert.ok(query.filters.some(([method, field, value]) => method === "eq" && field === "organization_id" && value === settingsOrganization));
    }
  });
  if (entry.mode === "WRITE") test(`ajustes ${entry.name} no hereda SUPERADMIN global con rol local de constructor`, async () => {
    const f = settingsFixture(); f.state.tenant!.platformRole = "CONSTRUCTOR";
    assert.equal((await f.actions[entry.name]!(...entry.args)).success, false);
    assert.equal(f.effects.includes("admin"), false); assert.equal(f.queries.length, 0);
  });
  else test(`ajustes ${entry.name} conserva lectura de miembro local sin rol global`, async () => {
    const f = settingsFixture(); f.state.tenant!.platformRole = "CONSTRUCTOR";
    assert.equal((await f.actions[entry.name]!(...entry.args)).success, true);
    assert.equal(f.effects.includes("review"), false);
  });
}

for (const name of ["updateSystemPromptAction", "restorePromptVersionAction"]) test(`ajustes ${name} rechaza prompt de otra organización`, async () => {
  const entry = SETTINGS_ACTION_CASES.find(action => action.name === name)!;
  const f = settingsFixture(); f.state.selectedPromptOrganization = foreignSettingsOrganization;
  assert.equal((await f.actions[name]!(...entry.args)).success, false);
  assert.equal(f.queries.some(query => query.operation !== "select"), false);
});
