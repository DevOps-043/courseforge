import test, {type TestContext} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, rm, realpath, link} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {admitWindowsNetworkRuntime, digestWindowsNetworkRuntimeManifest, WINDOWS_NETWORK_RUNTIME_POLICY,
  type WindowsNetworkRuntimeManifest} from "../qa/composition-windows-network-runtime-admission";
import {createAdmittedWindowsNetworkEdgeManagedExchange} from "../qa/composition-windows-network-edge-managed-exchange";

async function fixture(context: TestContext) {
  const allocated = await mkdtemp(join(tmpdir(), "network-runtime-"));
  context.after(() => rm(allocated, {recursive: true, force: true}));
  const directory = await realpath(allocated);
  const roles = {edgeEntry: "index.js", nativeAddon: "edge.node", managedAssembly: "client.dll"};
  const files = await Promise.all(Object.values(roles).map(async path => {
    const bytes = Buffer.from(`nonexecutable fixture ${path}`); await writeFile(join(directory, path), bytes);
    return {path, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length};
  }));
  const manifest: WindowsNetworkRuntimeManifest = {policy: WINDOWS_NETWORK_RUNTIME_POLICY.id,
    scope: "DECLARED_RUNTIME_BUNDLE_NOT_OS_OR_DYNAMIC_LOADING_PROOF", clr: "NET_FRAMEWORK_48",
    node: {version: process.version, modules: process.versions.modules!, arch: "x64"}, roles, files};
  const input = () => ({directory, manifest, expectedManifestSha256: digestWindowsNetworkRuntimeManifest(manifest)});
  return {directory, manifest, input};
}

test("runtime admission measures exact bytes, captures inputs and never loads fixture executables", async context => {
  const f = await fixture(context), input = f.input();
  const admitted = await admitWindowsNetworkRuntime(input, new AbortController().signal);
  assert.equal(admitted.receipt.fileCount, 3);
  assert.equal(admitted.paths.managedAssembly, join(f.directory, "client.dll"));
  f.manifest.files.length = 0;
  await admitted.assertUnchanged(new AbortController().signal);
  assert.equal(Object.isFrozen(admitted.paths), true);
});

test("runtime admission rejects unapproved manifest, mismatching ABI, duplicate case paths and unknown files", async context => {
  for (const mode of ["pin", "abi", "duplicate", "extra"] as const) {
    const f = await fixture(context);
    if (mode === "abi") f.manifest.node.modules = "999999";
    if (mode === "duplicate") f.manifest.files.push({...f.manifest.files[0], path: "INDEX.js"});
    if (mode === "extra") await writeFile(join(f.directory, "unexpected.dll"), "unknown");
    const input = f.input(); if (mode === "pin") input.expectedManifestSha256 = "a".repeat(64);
    await assert.rejects(admitWindowsNetworkRuntime(input, new AbortController().signal), /RUNTIME_ADMISSION_FAILED/);
  }
});

test("runtime file mutation latches failure even if original bytes are restored", async context => {
  const f = await fixture(context), admitted = await admitWindowsNetworkRuntime(f.input(), new AbortController().signal);
  await writeFile(join(f.directory, "edge.node"), "changed");
  await assert.rejects(admitted.assertUnchanged(new AbortController().signal), /RUNTIME_ADMISSION_FAILED/);
  await writeFile(join(f.directory, "edge.node"), "nonexecutable fixture edge.node");
  await assert.rejects(admitted.assertUnchanged(new AbortController().signal), /RUNTIME_ADMISSION_FAILED/);
});

test("runtime admission rejects hardlinks and missing declared dependencies", async context => {
  for (const mode of ["link", "missing"] as const) {
    const f = await fixture(context);
    if (mode === "link") await link(join(f.directory, "index.js"), join(f.directory, "index-copy.js"));
    else await rm(join(f.directory, "client.dll"));
    await assert.rejects(admitWindowsNetworkRuntime(f.input(), new AbortController().signal), /RUNTIME_ADMISSION_FAILED/);
  }
});

test("runtime admission is order-independent and rejects traversal, reserved paths and pre-abort", async context => {
  const f = await fixture(context), digest = digestWindowsNetworkRuntimeManifest(f.manifest);
  assert.equal(digestWindowsNetworkRuntimeManifest({...f.manifest, files: [...f.manifest.files].reverse()}), digest);
  for (const path of ["../evil.dll", "con.dll", "file.dll.", "file.dll:stream", "sub\\file.dll"])
    assert.throws(() => digestWindowsNetworkRuntimeManifest({...f.manifest,
      files: [{...f.manifest.files[0], path}, ...f.manifest.files.slice(1)]}));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(admitWindowsNetworkRuntime(f.input(), abort.signal), /RUNTIME_ADMISSION_FAILED/);
});

test("managed binding uses the admitted assembly and rejects foreign dependencies before edge.func", async context => {
  for (const extra of [false, true]) {
    const f = await fixture(context); let loads = 0, hostChecks = 0;
    if (extra) await writeFile(join(f.directory, "foreign.dll"), "unapproved");
    const result = createAdmittedWindowsNetworkEdgeManagedExchange({runtimeBundle: f.input(),
      assertHostIntegrity: async () => {hostChecks++;}, edge: {func(options) {
        loads++; assert.equal(options.assemblyFile, join(f.directory, "client.dll"));
        return (_input, done) => done(new Error("not invoked by preparation"));
      }}}, new AbortController().signal);
    if (extra) {await assert.rejects(result, /RUNTIME_ADMISSION_FAILED/); assert.equal(loads, 0); assert.equal(hostChecks, 0);}
    else {assert.equal(typeof await result, "function"); assert.equal(loads, 1); assert.equal(hostChecks, 2);}
  }
});
