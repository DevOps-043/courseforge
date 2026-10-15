import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectSnapshotCompatibility } from "./inspect-snapshot-compatibility.mjs";

const require = createRequire(import.meta.url);
const compiledRoot = "../../.tmp/cap029-tests/domains/production/composition-editor/";
const { createHtmlEditingRevisionFixture } = require(`${compiledRoot}__tests__/composition-html-editing-test-fixtures.js`);
const { bindHtmlEditingRevisionToComposition } = require(`${compiledRoot}composition-html-editing-document.server.js`);
const { freezeCompositionHtmlEditingSnapshot } = require(`${compiledRoot}composition-html-editing-snapshot-bundle.server.js`);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function artifact(context) {
  const directory = await mkdtemp(join(tmpdir(), "cap029-compatibility-"));
  context.after(() => rm(directory, { recursive: true })); // Exact directory created by this test, never a workspace/root.
  const input = createHtmlEditingRevisionFixture();
  const native = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 });
  const bundle = freezeCompositionHtmlEditingSnapshot({ document: native.document, context: {
    organizationId: input.authority.authoritativeBinding.organizationId, documentId: input.authority.authoritativeBinding.documentId,
    documentHash: native.documentHash, revisions: [{ ...input.authority, encodedRevision: JSON.stringify(input.next.revision) }],
  } });
  const file = join(directory, "bundle.json");
  await writeFile(file, bundle.encodedBundle);
  return { directory, bundle, options: { bundle: file, sha256: bundle.sha256,
    organization: input.authority.authoritativeBinding.organizationId, document: input.authority.authoritativeBinding.documentId,
    "document-hash": native.documentHash } };
}

test("local inspector checks real file bytes and scope without altering artifact", async context => {
  const { bundle, options } = await artifact(context);
  const result = await inspectSnapshotCompatibility(options);
  assert.equal(result.status, "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS");
  assert.equal(result.scope, "OFFLINE_COMPATIBILITY_NOT_AUTHORIZATION");
  assert.equal((await readFile(options.bundle, "utf8")), bundle.encodedBundle);
  assert.equal((await inspectSnapshotCompatibility({ ...options, sha256: "f".repeat(64) })).reason, "BYTE_INTEGRITY_MISMATCH");
  assert.equal((await inspectSnapshotCompatibility({ ...options, "document-hash": "f".repeat(64) })).reason, "SCOPE_MISMATCH");
});

test("historical profile returns review-only without source, permission or path disclosure", async context => {
  const { bundle, options } = await artifact(context);
  const historical = JSON.parse(bundle.encodedBundle);
  historical.compilation.profile.geometryVersion = "prior-version";
  const encoded = JSON.stringify(historical);
  await writeFile(options.bundle, encoded);
  const result = await inspectSnapshotCompatibility({ ...options, sha256: digest(encoded) });
  assert.equal(result.status, "PROFILE_MISMATCH_REQUIRES_REVIEW");
  assert.deepEqual(result.profileDifferences, ["geometryVersion"]);
  assert.doesNotMatch(JSON.stringify(result), /sourceHtml|conformance-media|grantedAssetIds|prior-version|bundle.json/);
});

test("relative paths, missing files, directories, extra options and oversized files fail safely", async context => {
  const { directory, options } = await artifact(context);
  for (const changed of [{ bundle: "relative.json" }, { bundle: join(directory, "missing.json") }, { bundle: directory },
    { permission: "allow" }]) {
    assert.equal((await inspectSnapshotCompatibility({ ...options, ...changed })).status, "REJECTED");
  }
  await writeFile(options.bundle, Buffer.alloc(16 * 1024 * 1024 + 1));
  assert.equal((await inspectSnapshotCompatibility(options)).reason, "ARTIFACT_UNAVAILABLE_OR_OVERSIZED");
});

test("invalid UTF8 with matching raw pin cannot pass canonical string-byte verification", async context => {
  const { options } = await artifact(context);
  const bytes = Buffer.from([0xff, 0xfe, 0x7b, 0x7d]);
  await writeFile(options.bundle, bytes);
  assert.equal((await inspectSnapshotCompatibility({ ...options, sha256: digest(bytes) })).reason, "BYTE_INTEGRITY_MISMATCH");
});

test("actual CLI reports machine-readable diagnostics and never implies a migration", async context => {
  const { options } = await artifact(context);
  const script = fileURLToPath(new URL("./inspect-snapshot-compatibility.mjs", import.meta.url));
  const run = args => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 });
  const result = run(Object.entries(options).flatMap(([key, value]) => [`--${key}`, value]));
  assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).status, "CURRENT_PROFILE_REQUIRES_CONTENT_AND_AUTHORITY_CHECKS");
  const rejected = run(["--bundle", options.bundle]);
  assert.equal(rejected.status, 1); assert.equal(rejected.stderr, "");
  assert.equal(JSON.parse(rejected.stdout).reason, "INVALID_OPTIONS");
});
