import test from "node:test";
import assert from "node:assert/strict";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createMaterializedProducerBridgeConfiguration} from "./materialized-producer-bridge-configuration.mjs";
import {decodeMaterializedProducerRequest} from "./materialized-producer-request.mjs";
function configuration() {
  const tools = dirname(fileURLToPath(import.meta.url)), runtime = resolve("runtime");
  const roles = Object.fromEntries(["node", "browser", "encoder", "decoder"].map(role => [role, {rootId: "runtime", path: `${role}.exe`}]));
  return {powerShellPath: join(runtime, "powershell.exe"), bridgeScriptPath: join(tools, "windows/owned-job-bridge.ps1"),
    outputParentDirectory: resolve("outputs"), measure: async () => {throw new Error("not called");},
    dependencyInventory: {roots: {runtime, tools}, manifest: {roles, files: [
      ...["node.exe", "browser.exe", "encoder.exe", "decoder.exe", "powershell.exe"].map(path => ({rootId: "runtime", path})),
      ...["windows/owned-job-bridge.ps1", "windows/OwnedRenderJob.cs", "run-materialized-producer.mjs",
        "controlled-materialized-producer.mjs", "materialized-producer-request.mjs",
        "materialized-producer-capture-audit.mjs"].map(path => ({rootId: "tools", path}))]}}};
}
test("bridge composition maps native binaries from admitted roles and uses fixed declared driver", () => {
  const input = configuration(), bridge = createMaterializedProducerBridgeConfiguration(input);
  const descriptor = {executionId: "00000000-0000-4000-8000-000000000001", organizationId: "00000000-0000-4000-8000-000000000002",
    revisionId: "00000000-0000-4000-8000-000000000003", documentHash: "a".repeat(64), projectHash: "b".repeat(64),
    contract: {schemaVersion: 4, documentHash: "a".repeat(64), canvas: {fps: 30},
      renderExecution: {sdkVersion: "0.7.106"}, renderProfile: {fps: 30, quality: "high", format: "mp4"}}};
  const directory = resolve("input");
  const launch = bridge.prepareLaunch(descriptor, {directory, entryPath: join(directory, "index.html"), receipt: descriptor});
  const request = decodeMaterializedProducerRequest(launch.arguments[2]);
  assert.equal(request.browserPath, resolve("runtime/browser.exe"));
  assert.equal(request.encoderPath, resolve("runtime/encoder.exe")); assert.equal(request.probePath, resolve("runtime/decoder.exe"));
  assert.equal(launch.executable, resolve("runtime/node.exe"));
});
test("absent measurement, unknown roles and undeclared driver fail before launching", () => {
  assert.throws(() => createMaterializedProducerBridgeConfiguration({...configuration(), measure: undefined}), /MEASUREMENT_REQUIRED/);
  const absent = configuration(); delete absent.dependencyInventory.manifest.roles.browser;
  assert.throws(() => createMaterializedProducerBridgeConfiguration(absent), /ROLE_REQUIRED/);
  const undeclared = configuration(); undeclared.dependencyInventory.manifest.files.pop();
  assert.throws(() => createMaterializedProducerBridgeConfiguration(undeclared), /INVENTORY_REQUIRED/);
});
