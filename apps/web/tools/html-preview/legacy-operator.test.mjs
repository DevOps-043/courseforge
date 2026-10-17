import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SignJWT } from "jose";
import { runLegacyOperator } from "./legacy-operator.mjs";

const require = createRequire(import.meta.url);
const {createLegacyOperatorFixture, actor, candidateId} = require("../../.tmp/cap029-tests/domains/production/composition-editor/__tests__/composition-html-editing-legacy-operator-fixtures.js");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function pinnedRequest(root, command) {
  const path = join(root, "command.json"), bytes = Buffer.from(JSON.stringify(command));
  await writeFile(path, bytes); return ["--request", path, "--sha256", digest(bytes)];
}
async function authenticatedEnvironment(fixture) {
  const secret = "synthetic-auth-bridge-secret-not-for-production";
  const token = await new SignJWT({app_metadata: {organization_ids: [actor]}}).setProtectedHeader({alg: "HS256"})
    .setSubject(actor).setExpirationTime("5m").sign(new TextEncoder().encode(secret));
  return {HTML_LEGACY_OPERATOR_ENABLED: "true", HTML_LEGACY_OPERATOR_HANDOFF_ROOT: fixture.handoffRoot,
    HTML_LEGACY_OPERATOR_INTENT_ROOT: fixture.intentRoot, HTML_LEGACY_OPERATOR_KEY_HEX: fixture.configuration.integrityKey.toString("hex"),
    HTML_LEGACY_OPERATOR_ACCESS_TOKEN: token, HTML_LEGACY_OPERATOR_ORGANIZATION: actor, COURSEFORGE_JWT_SECRET: secret,
    NEXT_PUBLIC_SUPABASE_URL: "https://storage.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key"};
}

test("private legacy CLI is closed by default and never echoes private configuration", async () => {
  const output = [];
  assert.equal(await runLegacyOperator([], {SUPABASE_SERVICE_ROLE_KEY: "PRIVATE_SECRET"}, entry => output.push(entry)), 1);
  assert.deepEqual(output, [{status: "UNCONFIRMED", reason: "HTML_LEGACY_OPERATOR_UNAVAILABLE", retryable: false}]);
});

test("real JWT/SDK entry prepares, reads, stages once and recovers historical registration without reinstalling or adopting", async () => {
  const fixture = await createLegacyOperatorFixture(), originalFetch = globalThis.fetch;
  try {
    const env = await authenticatedEnvironment(fixture), calls = [], output = [];
    let registered, registrations = 0, contextAvailable = true;
    globalThis.fetch = async (url, options) => {
      const address = new URL(String(url)); assert.equal(address.origin, "https://storage.example.test");
      calls.push(address.pathname);
      if (address.pathname === "/rest/v1/profiles") return Response.json({id: actor, platform_role: "ADMIN"});
      const parameters = JSON.parse(options.body);
      assert.equal(parameters.p_actor_id, actor);
      if (address.pathname === "/rest/v1/rpc/read_html_editing_bootstrap_context") {
        assert.ok(contextAvailable); return Response.json(fixture.context);
      }
      if (address.pathname === "/rest/v1/rpc/record_html_editing_legacy_candidate") {
        await fixture.handoff.readRegistrationIntent(candidateId);
        registered = parameters.p_candidate; registrations++;
        throw new Error("SYNTHETIC_ACK_LOST_AFTER_COMMIT");
      }
      assert.equal(address.pathname, "/rest/v1/rpc/read_html_editing_legacy_registration");
      return Response.json({status: "RECORDED", candidate: registered, revoked: true});
    };
    assert.equal(await runLegacyOperator(await pinnedRequest(fixture.root, fixture.prepare), env, entry => output.push(entry)), 0);
    const prepared = output.pop(); assert.equal(prepared.status, "PREPARED_LEGACY_PILOT_REQUIRES_REVIEW");
    assert.deepEqual(calls.map(path => path.split("/").at(-1)), ["profiles", "read_html_editing_bootstrap_context", "read_html_editing_bootstrap_context"]);
    assert.equal(await runLegacyOperator(await pinnedRequest(fixture.root, {action: "READ_PREPARATION", candidateId}), env, entry => output.push(entry)), 0);
    assert.deepEqual(output.pop(), prepared);
    const catalogPath = join(fixture.root, "installed-catalog.json"), catalogBytes = Buffer.from(JSON.stringify({
      format: "courseforge-html-editable-catalog-v1", organizationId: actor, templates: [fixture.pilot.candidate.template]}));
    await writeFile(catalogPath, catalogBytes);
    const stage = {action: "STAGE_REVIEWED", locator: prepared.locator, approval: fixture.approval,
      confirmation: "REGISTER_REVIEWED_LEGACY_PILOT_WITHOUT_ADOPTING_OR_INSTALLING"};
    const installed = {...env, HTML_LEGACY_OPERATOR_CATALOG_PATH: catalogPath, HTML_LEGACY_OPERATOR_CATALOG_SHA256: digest(catalogBytes)};
    const args = await pinnedRequest(fixture.root, stage);
    assert.equal(await runLegacyOperator(args, installed, entry => output.push(entry)), 1);
    assert.equal(await runLegacyOperator(args, installed, entry => output.push(entry)), 1); assert.equal(registrations, 1);
    contextAvailable = false; calls.length = 0;
    const intentPath = join(fixture.intentRoot, candidateId, "review-intent.json"), intent = await readFile(intentPath);
    assert.equal(await runLegacyOperator(await pinnedRequest(fixture.root, {action: "READ_REGISTRATION", candidateId}), env, entry => output.push(entry)), 0);
    assert.deepEqual(calls.map(path => path.split("/").at(-1)), ["profiles", "read_html_editing_legacy_registration"]);
    assert.equal(output.at(-1).revoked, true); assert.equal(output.at(-1).currentGrant, false);
    assert.deepEqual(await readFile(intentPath), intent); assert.equal(registrations, 1);
    assert.doesNotMatch(JSON.stringify(output), /encodedPilot|sourceHtml|synthetic-service-key|PRIVATE_SECRET|access_token/);
  } finally {globalThis.fetch = originalFetch; await fixture.cleanup();}
});

test("legacy CLI rejects invalid JWT, revoked role, changed command pin and source injection before any source RPC", async () => {
  const fixture = await createLegacyOperatorFixture(), originalFetch = globalThis.fetch;
  try {
    const env = await authenticatedEnvironment(fixture), calls = [], output = [];
    let role = "ADMIN";
    globalThis.fetch = async url => {
      const address = new URL(String(url)); calls.push(address.pathname);
      assert.equal(address.pathname, "/rest/v1/profiles"); return Response.json({id: actor, platform_role: role});
    };
    const args = await pinnedRequest(fixture.root, fixture.prepare);
    assert.equal(await runLegacyOperator(args, {...env, HTML_LEGACY_OPERATOR_ACCESS_TOKEN: "invalid"}, entry => output.push(entry)), 1);
    assert.equal(calls.length, 0);
    role = "CONSTRUCTOR";
    assert.equal(await runLegacyOperator(args, env, entry => output.push(entry)), 1); assert.equal(calls.length, 1);
    role = "ADMIN";
    assert.equal(await runLegacyOperator([...args.slice(0, 3), "f".repeat(64)], env, entry => output.push(entry)), 1);
    assert.equal(await runLegacyOperator(await pinnedRequest(fixture.root, {...fixture.prepare, sourceHtml: "PRIVATE_SOURCE"}), env, entry => output.push(entry)), 1);
    assert.deepEqual(calls, ["/rest/v1/profiles", "/rest/v1/profiles", "/rest/v1/profiles"]);
    assert.doesNotMatch(JSON.stringify(output), /PRIVATE_SOURCE|synthetic|command\.json|sourceHtml/);
  } finally {globalThis.fetch = originalFetch; await fixture.cleanup();}
});
