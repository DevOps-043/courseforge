import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { readPinnedOperatorJson, runHistoricalOperator } from "./historical-operator.mjs";

test("private CLI is disabled by default and never echoes credentials or paths", async () => {
  for (const args of [[], ["--request", "private", "--sha256", "private"], ["--unknown"]]) {
    const output = [];
    assert.equal(await runHistoricalOperator(args, {SUPABASE_SERVICE_ROLE_KEY: "do-not-print"}, entry => output.push(entry)), 1);
    assert.deepEqual(output, [{status: "UNCONFIRMED", reason: "HTML_HISTORICAL_OPERATOR_UNAVAILABLE", retryable: false}]);
  }
});

test("private CLI pinned JSON verifies exact bytes, UTF8, size and explicit local path", async () => {
  await mkdir(".tmp", {recursive: true}); const root = await mkdtemp(join(process.cwd(), ".tmp", "cap029-command-"));
  try {
    const path = join(root, "request.json"), bytes = Buffer.from('{"action":"PREPARE"}');
    await writeFile(path, bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.deepEqual(await readPinnedOperatorJson(path, hash), {action: "PREPARE"});
    await assert.rejects(readPinnedOperatorJson(path, "f".repeat(64)));
    await assert.rejects(readPinnedOperatorJson("relative.json", hash));
    await writeFile(path, Buffer.from([0xff]));
    await assert.rejects(readPinnedOperatorJson(path, createHash("sha256").update(await readFile(path)).digest("hex")));
    await writeFile(path, Buffer.alloc(128 * 1024 + 1));
    await assert.rejects(readPinnedOperatorJson(path, hash));
  } finally {await rm(root, {recursive: true, force: true});}
});

test("enabled private CLI verifies real JWT and current profile before SDK recovery, without remote writes", async () => {
  await mkdir(".tmp", {recursive: true}); const root = await mkdtemp(join(process.cwd(), ".tmp", "cap029-command-"));
  const actor = "11111111-1111-4111-8111-111111111111", org = "22222222-2222-4222-8222-222222222222";
  const originalFetch = globalThis.fetch;
  try {
    const secret = "synthetic-auth-bridge-secret-not-for-production", token = await new SignJWT({app_metadata: {organization_ids: [org]}})
      .setProtectedHeader({alg: "HS256"}).setSubject(actor).setExpirationTime("5m").sign(new TextEncoder().encode(secret));
    const path = join(root, "request.json"), input = {action: "READ_STAGING", locator: {
      scope: "HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION", reviewerId: actor, organizationId: org,
      compositionId: actor, draftId: actor, candidateId: org, projectHash: "a".repeat(64), evidenceSha256: "b".repeat(64), candidateSha256: "c".repeat(64)}};
    const bytes = Buffer.from(JSON.stringify(input)); await writeFile(path, bytes);
    const args = ["--request", path, "--sha256", createHash("sha256").update(bytes).digest("hex")];
    const env = {HTML_HISTORICAL_OPERATOR_ENABLED: "true", HTML_HISTORICAL_HANDOFF_ROOT: root,
      HTML_HISTORICAL_HANDOFF_KEY_HEX: "d".repeat(64), COURSEFORGE_JWT_SECRET: secret,
      HTML_HISTORICAL_OPERATOR_ACCESS_TOKEN: token, HTML_HISTORICAL_OPERATOR_ORGANIZATION: org,
      NEXT_PUBLIC_SUPABASE_URL: "https://storage.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-private-key"};
    const calls = []; let role = "ADMIN";
    globalThis.fetch = async (url, options) => {
      const address = new URL(String(url)); calls.push(address.pathname);
      assert.equal(address.origin, "https://storage.example.test");
      if (address.pathname === "/rest/v1/profiles") return Response.json({id: actor, platform_role: role});
      assert.equal(address.pathname, "/rest/v1/rpc/read_html_historical_staging");
      assert.equal(JSON.parse(options.body).p_actor, actor);
      return Response.json({status: "NOT_FOUND"});
    };
    const output = [];
    assert.equal(await runHistoricalOperator(args, env, entry => output.push(entry)), 0);
    assert.deepEqual(output, [{status: "NOT_FOUND"}]); assert.equal(calls.length, 2);
    role = "CONSTRUCTOR"; calls.length = 0; output.length = 0;
    assert.equal(await runHistoricalOperator(args, env, entry => output.push(entry)), 1);
    assert.equal(calls.length, 1);
    calls.length = 0;
    assert.equal(await runHistoricalOperator(args, {...env, HTML_HISTORICAL_OPERATOR_ACCESS_TOKEN: "invalid"}, entry => output.push(entry)), 1);
    assert.equal(calls.length, 0);
    assert.doesNotMatch(JSON.stringify(output), /synthetic|private-key|access_token/);
  } finally {globalThis.fetch = originalFetch; await rm(root, {recursive: true, force: true});}
});
