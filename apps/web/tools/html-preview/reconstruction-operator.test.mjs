import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { SignJWT } from "jose";
import { runReconstructionOperator } from "./reconstruction-operator.mjs";
import { readPinnedOperatorJson } from "./historical-operator.mjs";

const require = createRequire(import.meta.url), compiled = "../../.tmp/cap029-tests/domains/production/composition-editor/";
test("reconstruction CLI is disabled by default and errors never reveal secrets or paths", async () => {
  for (const args of [[], ["--request", "private-path", "--sha256", "invalid"], ["--unknown"]]) {
    const output = [];
    assert.equal(await runReconstructionOperator(args, {SUPABASE_SERVICE_ROLE_KEY: "do-not-print"}, entry => output.push(entry)), 1);
    assert.deepEqual(output, [{status: "UNCONFIRMED", reason: "HTML_RECONSTRUCTION_OPERATOR_UNAVAILABLE", retryable: false}]);
  }
});

test("bounded pinned reader supports native requests above historical limit without changing the default", async () => {
  await mkdir(".tmp", {recursive: true}); const root = await mkdtemp(join(process.cwd(), ".tmp", "cap029-reconstruction-cli-"));
  try {
    const path = join(root, "request.json"), bytes = Buffer.from(JSON.stringify({text: "a".repeat(128 * 1024)}));
    const digest = createHash("sha256").update(bytes).digest("hex"); await writeFile(path, bytes);
    await assert.rejects(readPinnedOperatorJson(path, digest));
    assert.equal((await readPinnedOperatorJson(path, digest, 256 * 1024)).text.length, 128 * 1024);
    for (const bound of [0, -1, 1.5, Infinity, 16 * 1024 * 1024 + 1]) await assert.rejects(readPinnedOperatorJson(path, digest, bound));
  } finally {await rm(root, {recursive: true, force: true});}
});

test("enabled CLI authenticates real JWT/current role and reconciles concrete review journal read-only", async () => {
  const {createReconstructionPersistenceFixture} = require(compiled + "__tests__/composition-html-editing-reconstruction-persistence-fixtures.js");
  const {createHtmlReconstructionReviewJournal} = require(compiled + "composition-html-editing-reconstruction-review-journal.server.js");
  const f = await createReconstructionPersistenceFixture();
  await mkdir(".tmp", {recursive: true}); const root = await mkdtemp(join(process.cwd(), ".tmp", "cap029-reconstruction-cli-"));
  const oldFetch = globalThis.fetch;
  try {
    const handoffRoot = join(root, "handoff"), reviewRoot = join(root, "reviews"), operationRoot = join(root, "operations");
    await mkdir(handoffRoot); await mkdir(reviewRoot); await mkdir(operationRoot);
    await createHtmlReconstructionReviewJournal({rootDirectory: reviewRoot, integrityKey: Buffer.alloc(32, 21)}).preserve(f.review);
    const secret = "synthetic-reconstruction-auth-secret-not-production", actor = f.review.approval.reviewerId, org = f.review.locator.organizationId;
    const token = await new SignJWT({app_metadata: {organization_ids: [org]}}).setProtectedHeader({alg: "HS256"})
      .setSubject(actor).setExpirationTime("5m").sign(new TextEncoder().encode(secret));
    const path = join(root, "request.json"), bytes = Buffer.from(JSON.stringify({action: "READ_REVIEW", candidateId: f.review.locator.candidateId}));
    await writeFile(path, bytes); const args = ["--request", path, "--sha256", createHash("sha256").update(bytes).digest("hex")];
    const env = {HTML_RECONSTRUCTION_OPERATOR_ENABLED: "true", HTML_RECONSTRUCTION_HANDOFF_ROOT: handoffRoot,
      HTML_RECONSTRUCTION_REVIEW_ROOT: reviewRoot, HTML_RECONSTRUCTION_OPERATION_ROOT: operationRoot,
      HTML_RECONSTRUCTION_KEY_HEX: Buffer.alloc(32, 21).toString("hex"), COURSEFORGE_JWT_SECRET: secret,
      HTML_RECONSTRUCTION_OPERATOR_ACCESS_TOKEN: token, HTML_RECONSTRUCTION_OPERATOR_ORGANIZATION: org,
      NEXT_PUBLIC_SUPABASE_URL: "https://storage.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-private-key"};
    const calls = []; let role = "ADMIN";
    globalThis.fetch = async (url, options) => {
      const address = new URL(String(url)); calls.push(address.pathname); assert.equal(address.origin, "https://storage.example.test");
      if (address.pathname === "/rest/v1/profiles") return Response.json({id: actor, platform_role: role});
      assert.equal(address.pathname, "/rest/v1/rpc/read_html_reconstruction_review");
      assert.deepEqual(JSON.parse(options.body).p_record, f.review); return Response.json({status: "NOT_FOUND"});
    };
    const output = [];
    assert.equal(await runReconstructionOperator(args, env, entry => output.push(entry)), 0);
    assert.deepEqual(output, [{status: "NOT_FOUND"}]); assert.equal(calls.length, 3);
    assert.equal(calls.filter(path => path.includes("/rpc/")).length, 1);
    role = "CONSTRUCTOR"; calls.length = 0; output.length = 0;
    assert.equal(await runReconstructionOperator(args, env, entry => output.push(entry)), 1); assert.equal(calls.length, 1);
    calls.length = 0;
    assert.equal(await runReconstructionOperator(args, {...env, HTML_RECONSTRUCTION_OPERATOR_ACCESS_TOKEN: "invalid"}, entry => output.push(entry)), 1);
    assert.equal(calls.length, 0); assert.doesNotMatch(JSON.stringify(output), /synthetic|private-key|request.json/);
  } finally {globalThis.fetch = oldFetch; await rm(root, {recursive: true, force: true});}
});
