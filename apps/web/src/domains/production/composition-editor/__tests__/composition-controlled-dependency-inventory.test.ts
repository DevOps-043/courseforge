import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {link, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {controlledRenderExecutionContractSchema} from "../composition-render-execution-contract";
import {pinConformanceFile} from "../qa/composition-conformance-file-integrity";
import {createControlledRenderWorkerHost} from "../qa/composition-controlled-render-worker-host";
import {createInitialCompositionDocument} from "../composition-document.factory";
import {hashCompositionDocument} from "../composition-document.service";
import {buildSnapshotConformanceContract} from "../composition-snapshot-conformance-contract";
import {admitControlledDependencyInventory, digestControlledDependencyManifest,
  CONTROLLED_DEPENDENCY_INVENTORY_POLICY, type ControlledDependencyManifest} from "../qa/composition-controlled-dependency-inventory";

const contents = "operator pinned dependency";
const identity = {sha256: createHash("sha256").update(contents).digest("hex"), sizeBytes: Buffer.byteLength(contents)};
async function fixture() {
  const parent = resolve("apps/web/.tmp");
  await mkdir(parent, {recursive: true});
  const root = await mkdtemp(join(parent, "dependency-inventory-"));
  await mkdir(join(root, "lib"));
  await writeFile(join(root, "lib", "entry.js"), contents);
  const reference = {rootId: "sdk", path: "lib/entry.js"};
  const manifest: ControlledDependencyManifest = {policy: CONTROLLED_DEPENDENCY_INVENTORY_POLICY.id,
    roots: ["sdk"], files: [{...reference, ...identity}], roles: {
      node: reference, producer: reference, engine: reference, runtime: reference,
      browser: reference, encoder: reference, decoder: reference,
    }};
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106", files: Object.fromEntries(Object.keys(manifest.roles).map(role => [role, identity])),
    expectedBrowser: {protocolVersion: "1.3", product: "Test", revision: "Test", userAgent: "Test", jsVersion: "Test"}});
  const configuration = {manifest, expectedManifestSha256: digestControlledDependencyManifest(manifest), roots: {sdk: root}};
  const repin = () => {configuration.expectedManifestSha256 = digestControlledDependencyManifest(manifest);};
  // Only this test-owned mkdtemp directory is removed; never remove its parent.
  return {root, manifest, execution, configuration, repin, cleanup: () => rm(root, {recursive: true, force: true})};
}

test("exact declared tree admits and emits bounded metadata without host paths", async () => {
  const f = await fixture();
  try {
    const admitted = await admitControlledDependencyInventory(f.configuration, f.execution);
    assert.equal(admitted.receipt.fileCount, 1);
    assert.equal(admitted.receipt.totalBytes, identity.sizeBytes);
    assert.equal(admitted.receipt.manifestSha256, f.configuration.expectedManifestSha256);
    assert.equal(JSON.stringify(admitted.receipt).includes(f.root), false);
    await admitted.assertUnchanged();
  } finally {await f.cleanup();}
});

test("manifest digest does not depend on file/root array order", () => {
  const reference = {rootId: "sdk", path: "entry.js"};
  const manifest = {policy: CONTROLLED_DEPENDENCY_INVENTORY_POLICY.id, roots: ["sdk", "tools"],
    files: [{...reference, ...identity}, {...reference, rootId: "tools", ...identity}],
    roles: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, reference]))};
  assert.equal(digestControlledDependencyManifest(manifest), digestControlledDependencyManifest({...manifest,
    roots: [...manifest.roots].reverse(), files: [...manifest.files].reverse()}));
});

test("missing, added and altered files reject both admission and post-execution recheck", async () => {
  for (const mutation of ["missing", "added", "changed"] as const) {
    const f = await fixture();
    try {
      const admitted = await admitControlledDependencyInventory(f.configuration, f.execution);
      if (mutation === "missing") await rm(join(f.root, "lib", "entry.js"));
      if (mutation === "added") await writeFile(join(f.root, "injected.js"), "unexpected");
      if (mutation === "changed") await writeFile(join(f.root, "lib", "entry.js"), "modified");
      await assert.rejects(admitted.assertUnchanged(), /DEPENDENCY_|CONFORMANCE_FILE_/);
      await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution), /DEPENDENCY_|CONFORMANCE_FILE_/);
    } finally {await f.cleanup();}
  }
});

test("wrong manifest pin, unbound roots and role mismatches fail closed", async () => {
  const f = await fixture();
  try {
    await assert.rejects(admitControlledDependencyInventory({...f.configuration, expectedManifestSha256: "f".repeat(64)}, f.execution), /MANIFEST_MISMATCH/);
    await assert.rejects(admitControlledDependencyInventory({...f.configuration, roots: {sdk: f.root, extra: f.root}}, f.execution), /ROOTS_INVALID/);
    await assert.rejects(admitControlledDependencyInventory(f.configuration, {...f.execution,
      files: {...f.execution.files, encoder: {...identity, sha256: "f".repeat(64)}}}), /ROLE_MISMATCH/);
  } finally {await f.cleanup();}
});

test("duplicate files, unknown root references and traversal never become trusted inventory", async () => {
  const f = await fixture();
  try {
    f.manifest.files.push({...f.manifest.files[0]}); f.repin();
    await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution), /MANIFEST_INVALID/);
    f.manifest.files.pop(); f.manifest.files[0].rootId = "foreign"; f.repin();
    await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution), /MANIFEST_INVALID/);
    f.manifest.files[0].path = "../secret";
    await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution), /ADMISSION_FAILED/);
  } finally {await f.cleanup();}
});

test("comparison decoder and probe must be explicitly bound in both manifest and contract", async () => {
  const f = await fixture();
  try {
    f.manifest.comparisonTools = {pixelDecoder: f.manifest.roles.decoder, probe: f.manifest.roles.decoder}; f.repin();
    await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution), /ROLE_MISMATCH/);
    const execution = {...f.execution, comparisonTools: {policy: "EXPLICIT_PIXEL_DECODER_AND_PROBE_V1" as const,
      pixelDecoder: identity, probe: identity}};
    await admitControlledDependencyInventory(f.configuration, execution);
    execution.comparisonTools.probe = {...identity, sizeBytes: identity.sizeBytes + 1};
    await assert.rejects(admitControlledDependencyInventory(f.configuration, execution), /ROLE_MISMATCH/);
  } finally {await f.cleanup();}
});

test("empty unlisted directory additions invalidate the tree, not only its file set", async () => {
  const f = await fixture();
  try {
    const admitted = await admitControlledDependencyInventory(f.configuration, f.execution);
    await mkdir(join(f.root, "added-directory"));
    await assert.rejects(admitted.assertUnchanged(), /TREE_CHANGED/);
  } finally {await f.cleanup();}
});

test("directory symlinks are rejected without following or exposing their target", async () => {
  const f = await fixture();
  try {
    await symlink(join(f.root, "lib"), join(f.root, "linked"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution), /ENTRY_INVALID/);
  } finally {await f.cleanup();}
});

test("hardlinked inputs are rejected even when their bytes and declared identity match", async () => {
  const f = await fixture();
  try {
    await link(join(f.root, "lib", "entry.js"), join(f.root, "hardlinked.js"));
    f.manifest.files.push({rootId: "sdk", path: "hardlinked.js", ...identity}); f.repin();
    await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution), /ENTRY_INVALID/);
  } finally {await f.cleanup();}
});

test("pre-abort and post-admission abort reject without returning evidence", async () => {
  const f = await fixture();
  try {
    const controller = new AbortController();
    const admitted = await admitControlledDependencyInventory(f.configuration, f.execution, controller.signal);
    controller.abort(new Error("private operator reason"));
    await assert.rejects(admitted.assertUnchanged(), {message: "CONTROLLED_RENDER_DEPENDENCY_ABORTED"});
    await assert.rejects(admitControlledDependencyInventory(f.configuration, f.execution, controller.signal), {message: "CONTROLLED_RENDER_DEPENDENCY_ABORTED"});
  } finally {await f.cleanup();}
});

test("incidental empty files are pinned without permitting empty executable role identities", async () => {
  const f = await fixture();
  try {
    const path = join(f.root, "empty-marker");
    await writeFile(path, "");
    f.manifest.files.push({rootId: "sdk", path: "empty-marker", sizeBytes: 0,
      sha256: createHash("sha256").update("").digest("hex")}); f.repin();
    const admitted = await admitControlledDependencyInventory(f.configuration, f.execution);
    assert.equal(admitted.receipt.fileCount, 2);
    await admitted.assertUnchanged();
    await assert.rejects(pinConformanceFile(path, 100), /CONFORMANCE_FILE_INVALID/);
    await writeFile(path, "injected");
    await assert.rejects(admitted.assertUnchanged(), /CONFORMANCE_FILE_INTEGRITY_MISMATCH/);
  } finally {await f.cleanup();}
});

test("worker host requires operator inventory before resolving signing keys or creating a supervisor", async () => {
  const f = await fixture();
  try {
    let signingCalls = 0;
    const host = createControlledRenderWorkerHost({resolveSigningKey: () => {
      signingCalls++; throw new Error("must not acquire key");}} as never);
    const uuid = "00000000-0000-4000-8000-000000000001";
    const document = createInitialCompositionDocument({animatedDeck: null, assets: [{productionAssetId: uuid,
      durationSeconds: 10, timelineRole: "BROLL", hasAudio: false, publicUrl: null,
      storageBucket: "production-assets", storagePath: "fixture.mp4", mimeType: "video/mp4",
      checksum: identity.sha256, fileSizeBytes: identity.sizeBytes}],
      plan: {accentColor: "#38BDF8", durationSeconds: 10, title: "Pinned", subtitle: "Local"}});
    const contract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [{id: uuid, checksum: identity.sha256}],
      contractVersion: 4, renderExecution: f.execution,
      renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
    await assert.rejects(host({organizationId: uuid, requestId: uuid, revisionId: uuid, productionJobId: uuid,
      workerId: "worker", leaseToken: uuid, issuanceId: uuid, attempt: 1, supervisorId: "supervisor", keyId: "key",
      action: "EXECUTE", executionId: null, contract}), /CONTROLLED_RENDER_DEPENDENCY_INVENTORY_REQUIRED/);
    assert.equal(signingCalls, 0);
  } finally {await f.cleanup();}
});
