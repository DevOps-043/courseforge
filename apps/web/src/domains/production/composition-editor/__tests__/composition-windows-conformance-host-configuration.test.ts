import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, mkdir, writeFile, rm, rmdir, realpath} from "node:fs/promises";
import {join, resolve} from "node:path";
import {createHash} from "node:crypto";
import {loadWindowsConformanceHostConfiguration} from "../qa/composition-windows-conformance-host-configuration";
import {digestControlledDependencyManifest} from "../qa/composition-controlled-dependency-inventory";

const sha = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const parent = resolve("apps/web/.tmp");
  await mkdir(parent, {recursive: true});
  const root = await realpath(await mkdtemp(join(parent, "conformance-host-config-")));
  const install = join(root, "install"), outputs = join(root, "outputs"), fences = join(root, "fences");
  for (const directory of [install, outputs, fences]) await mkdir(directory);
  const names = ["node.exe", "powershell.exe", "bridge.ps1", "decoder.exe", "probe.exe"];
  const location = (path: string) => ({rootId: "install", path});
  const manifest = {policy: "EXACT_DECLARED_DEPENDENCY_TREES_V1", roots: ["install"],
    files: names.map(path => ({...location(path), sha256: sha(path), sizeBytes: Buffer.byteLength(path)})),
    roles: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"].map(role => [role, location("node.exe")])),
    comparisonTools: {pixelDecoder: location("decoder.exe"), probe: location("probe.exe")}};
  const configuration = {policy: "WINDOWS_RESERVED_CONFORMANCE_HOST_V1",
    dependencyInventory: {manifest, expectedManifestSha256: digestControlledDependencyManifest(manifest), roots: {install}},
    outputParentDirectory: outputs, powerShellPath: join(install, "powershell.exe"), bridgeScriptPath: join(install, "bridge.ps1"),
    measurementFence: {directory: fences, hostId: "stable-measurement-host"}};
  const path = join(root, "operator.json");
  const save = async (value: unknown) => {const bytes = JSON.stringify(value); await writeFile(path, bytes); return {path, sha256: sha(bytes)};};
  return {configuration, save, close: async () => {await rm(path, {force: true});
    for (const directory of [install, outputs, fences]) await rmdir(directory); await rmdir(root);}};
}

test("operator configuration is pinned data and leaves silent V2 disabled by default", async () => {
  const f = await fixture();
  try {
    const result = await loadWindowsConformanceHostConfiguration(await f.save(f.configuration));
    assert.equal(result.configuration.enableSilentDurableReports, false);
    assert.equal(result.ffmpegPath, join(f.configuration.dependencyInventory.roots.install, "decoder.exe"));
  } finally {await f.close();}
});

test("changed operator bytes and unpinned inventory fail before host construction", async () => {
  const f = await fixture();
  try {
    const pin = await f.save(f.configuration);
    await assert.rejects(loadWindowsConformanceHostConfiguration({...pin, sha256: "f".repeat(64)}), /PIN_MISMATCH/);
    await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      dependencyInventory: {...f.configuration.dependencyInventory, expectedManifestSha256: "f".repeat(64)}})), /INVENTORY_INVALID/);
  } finally {await f.close();}
});

test("operator data cannot inject scripts, relative paths or undeclared tools", async () => {
  const f = await fixture();
  try {
    for (const mutation of [{script: "arbitrary.mjs"}, {outputParentDirectory: "../output"},
      {powerShellPath: join(f.configuration.dependencyInventory.roots.install, "foreign.exe")}])
      await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration, ...mutation})), /CONFIGURATION_/);
  } finally {await f.close();}
});

test("cancelled configuration load cannot construct or start a host", async () => {
  const f = await fixture();
  try {
    const pin = await f.save(f.configuration), controller = new AbortController(); controller.abort();
    await assert.rejects(loadWindowsConformanceHostConfiguration(pin, controller.signal), /EXECUTION_CANCELLED/);
  } finally {await f.close();}
});

test("pinned operator quotas are preserved and invalid quotas cannot enter the host", async () => {
  const f = await fixture();
  const resourceLimits = {policy: "WINDOWS_JOB_RESOURCE_LIMITS_V1", maximumProcesses: 8,
    processMemoryBytes: 256 * 1024 ** 2, jobMemoryBytes: 512 * 1024 ** 2, userCpuSeconds: 60, cpuRatePercent: 25};
  try {
    const admitted = await loadWindowsConformanceHostConfiguration(await f.save({...f.configuration, resourceLimits}));
    assert.deepEqual(admitted.configuration.resourceLimits, resourceLimits);
    for (const mutation of [{cpuRatePercent: "25"}, {cpuRatePercent: 0}, {maximumProcesses: 65},
      {processMemoryBytes: 1024 * 1024 ** 2}, {jobMemoryBytes: 5 * 1024 ** 3}])
      await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
        resourceLimits: {...resourceLimits, ...mutation}})), /HOST_CONFIGURATION_INVALID/);
  } finally {await f.close();}
});

test("pinned reduced-token policy requires explicit quotas and an isolated desktop name", async () => {
  const f = await fixture();
  const resourceLimits = {policy: "WINDOWS_JOB_RESOURCE_LIMITS_V1", maximumProcesses: 8,
    processMemoryBytes: 256 * 1024 ** 2, jobMemoryBytes: 512 * 1024 ** 2, userCpuSeconds: 60, cpuRatePercent: 25};
  const reducedToken = {policy: "WINDOWS_LUA_NO_PRIVILEGES_V1", desktop: "winsta0\\courseforge-worker"};
  try {
    const admitted = await loadWindowsConformanceHostConfiguration(await f.save({...f.configuration, resourceLimits, reducedToken}));
    assert.deepEqual(admitted.configuration.reducedToken, reducedToken);
    const restricted = {...reducedToken, policy: "WINDOWS_LUA_RESTRICTING_CAPABILITY_V2",
      restrictingSid: "S-1-15-3-1024-1-2-3-4-5-6-7-8"};
    const restrictedHost = await loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      resourceLimits, reducedToken: restricted}));
    assert.deepEqual(restrictedHost.configuration.reducedToken, restricted);
    const preflight = {...restricted, policy: "WINDOWS_LUA_ACL_PREFLIGHT_V3",
      readOnlyPaths: [f.configuration.dependencyInventory.roots.install], deniedPaths: [f.configuration.measurementFence.directory]};
    const preflightHost = await loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      resourceLimits, reducedToken: preflight}));
    assert.deepEqual(preflightHost.configuration.reducedToken, preflight);
    const treePolicy = {...preflight, policy: "WINDOWS_LUA_ACL_TREE_PREFLIGHT_V4",
      treeAudit: {maximumEntries: 4096, maximumDepth: 16, timeoutMilliseconds: 10000}};
    const treeHost = await loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      resourceLimits, reducedToken: treePolicy}));
    assert.deepEqual(treeHost.configuration.reducedToken, treePolicy);
    const appContainer = {policy: "WINDOWS_APPCONTAINER_NO_NETWORK_V5", desktop: reducedToken.desktop,
      appContainerSid: "S-1-15-2-1-2-3-4-5-6-7", readOnlyPaths: treePolicy.readOnlyPaths,
      deniedPaths: treePolicy.deniedPaths, treeAudit: treePolicy.treeAudit};
    const appContainerHost = await loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      resourceLimits, reducedToken: appContainer}));
    assert.deepEqual(appContainerHost.configuration.reducedToken, appContainer);
    await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      resourceLimits, reducedToken: {...appContainer, capabilities: ["internetClient"]}})), /CONFIGURATION_INVALID/);
    await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      resourceLimits, reducedToken: {...preflight, deniedPaths: []}})), /CONFIGURATION_INVALID/);
    await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration,
      resourceLimits, reducedToken: {...restricted, restrictingSid: "S-1-1-0"}})), /CONFIGURATION_INVALID/);
    await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration, reducedToken})), /CONFIGURATION_INVALID/);
    for (const mutation of [{desktop: "winsta0\\default"}, {desktop: "winsta0\\DEFAULT"},
      {desktop: "winsta0\\custom\n"}, {policy: "UNRESTRICTED"}, {fallback: true}])
      await assert.rejects(loadWindowsConformanceHostConfiguration(await f.save({...f.configuration, resourceLimits,
        reducedToken: {...reducedToken, ...mutation}})), /CONFIGURATION_INVALID/);
  } finally {await f.close();}
});
