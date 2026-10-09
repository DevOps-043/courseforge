import assert from "node:assert/strict";
import test from "node:test";
import {readdir, readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {join, relative} from "node:path";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../apps/web/dist/composition-worker/", import.meta.url));
const qa = join(root, "domains/production/composition-editor/qa");

test("operational entries load without starting a worker, decoder or producer", () => {
  for (const [file, exportName] of [
    ["composition-conformance-job-worker", "processConformanceJob"],
    ["composition-conformance-job-execution", "executeConformanceJob"],
    ["composition-reserved-conformance-worker-host", "createReservedConformanceWorkerHost"],
    ["composition-conformance-render-reservation.service", "CompositionConformanceRenderReservationService"],
    ["composition-windows-reserved-conformance-ports", "createWindowsReservedConformancePortResolver"],
    ["composition-windows-conformance-host-configuration", "loadWindowsConformanceHostConfiguration"],
    ["composition-controlled-render-worker-host", "createControlledRenderWorkerHost"],
    ["composition-windows-render-worker-host", "createWindowsControlledRenderWorkerHost"],
    ["composition-windows-comparison-process-ports", "createWindowsComparisonProcessPorts"],
    ["composition-controlled-reference-measurement", "measureControlledConformanceReferences"],
    ["composition-controlled-reference-selection", "createControlledReferenceSelectionResolver"],
    ["composition-exported-video-conformance", "compareExportedVideoWithPreview"],
    ["composition-conformance-file-integrity", "pinConformanceFile"],
    ["composition-original-session-font-capture", "startOriginalSessionFontCapture"],
    ["composition-borrowed-producer-cdp", "borrowProducerCdpChannel"],
  ]) assert.equal(typeof require(join(qa, `${file}.js`))[exportName], "function", file);
});

test("emitted dependency closure excludes test files, routes and temporary build imports", async () => {
  let files = 0;
  async function inspect(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, relative(root, path));
      assert.doesNotMatch(relative(root, path), /(?:__tests__|\.test\.|(?:^|[\\/])app[\\/])/);
      if (entry.isDirectory()) await inspect(path);
      else {
        assert.equal(entry.isFile(), true);
        assert.match(entry.name, /\.js$/);
        assert.notEqual(entry.name, "hyperframes-plan.service.js", "worker must not compile the AI plan service");
        const source = await readFile(path, "utf8");
        assert.doesNotMatch(source, /hyperframes-tests|require\(["']@\//, relative(root, path));
        assert.doesNotMatch(source, /require\(["']@google\/genai["']\)/, relative(root, path));
        files++;
      }
    }
  }
  await inspect(root);
  assert.ok(files >= 7);
});

test("operational consumers use the production build with no test-build fallback", async () => {
  for (const file of ["run-composition-conformance-worker.mjs", "run-composition-final-video-gate.mjs",
    "../apps/web/tools/controlled-hyperframes/materialized-producer-collector.mjs"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, /dist\/composition-worker/);
    assert.doesNotMatch(source, /hyperframes-tests/);
  }
});

test("fixed reference measurer import does not launch jobs and requires explicit operator authority", async () => {
  const {createMaterializedProducerReferenceBridgeConfiguration} = await import("../apps/web/tools/controlled-hyperframes/materialized-reference-measurer.mjs");
  assert.throws(() => createMaterializedProducerReferenceBridgeConfiguration({}), /CONFIGURATION_REQUIRED/);
  assert.throws(() => createMaterializedProducerReferenceBridgeConfiguration({operatorConfiguration: {}, supabase: {},
    resolveReferences: () => [], measurementFence: {}, measure: () => {}}), /CONFIGURATION_REQUIRED/);
  assert.throws(() => createMaterializedProducerReferenceBridgeConfiguration({operatorConfiguration: {}, supabase: {},
    resolveReferences: () => [], measurementFence: {}, dependencyInventory: {manifest: {files: []}, roots: {}}}), /INVENTORY_REQUIRED/);
});

test("compiler preserves native dynamic import for the ESM-only SDK subpath", async () => {
  const compiler = await readFile(join(root, "domains/production/composition-editor/composition-preview-compiler.service.js"), "utf8");
  assert.match(compiler, /import\(["']@hyperframes\/core\/color-grading["']\)/);
  assert.doesNotMatch(compiler, /require\(["']@hyperframes\/core\/color-grading["']\)/);
});
