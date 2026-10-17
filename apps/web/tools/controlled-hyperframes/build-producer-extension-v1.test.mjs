import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, writeFile, rm, link, symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {buildProducerExtensionPackage, verifyProducerExtensionPackage,
  projectProducerExtensionInventory, PRODUCER_PACKAGE_MANIFEST} from "./build-producer-extension-v1.mjs";
import {hashBytes, snapshotProducerPackage} from "./producer-extension-files.mjs";

const sourceDirectory = fileURLToPath(new URL("./node_modules/@hyperframes/producer", import.meta.url));
const signal = () => new AbortController().signal;
const digest = tree => hashBytes(Buffer.from(JSON.stringify(tree)));

test("complete real package builds reproducibly without touching vendor and verifies with external digest", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "courseforge-extension-package-"));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const initial = await snapshotProducerPackage(sourceDirectory);
  const first = await buildProducerExtensionPackage({sourceDirectory, outputDirectory: join(temporary, "first"), signal: signal()});
  const second = await buildProducerExtensionPackage({sourceDirectory, outputDirectory: join(temporary, "second"), signal: signal()});
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.sourceFiles.length + 1, first.manifest.outputFiles.length);
  for (const source of initial) {
    const copied = first.manifest.outputFiles.find(file => file.path === source.path);
    assert.ok(copied, `preserved ${source.path}`);
    if (source.path !== "dist/index.js") assert.deepEqual(copied, source);
  }
  assert.deepEqual(await readFile(join(first.directory, "LICENSE")), await readFile(join(sourceDirectory, "LICENSE")));
  assert.equal(digest(initial), digest(await snapshotProducerPackage(sourceDirectory)));
  const admission = {directory: first.directory, expectedManifestSha256: first.manifestSha256, signal: signal()};
  const verified = await verifyProducerExtensionPackage(admission);
  assert.equal(verified.entryPath, first.entryPath);
  assert.equal(verified.scope, "PACKAGE_BYTES_VERIFIED_NOT_DEPENDENCY_CLOSURE_OR_SANDBOX");
  assert.equal(verified.files.length, first.manifest.outputFiles.length + 1);

  await t.test("inventory fragment includes package marker/runtime and binds only producer role", async () => {
    const fragment = await projectProducerExtensionInventory({...admission, rootId: "producer_extension_v1"});
    assert.equal(fragment.scope, "INVENTORY_FRAGMENT_REQUIRES_HOST_ADMISSION");
    assert.deepEqual(fragment.producer, {rootId: "producer_extension_v1", path: "dist/index.js"});
    assert.ok(fragment.files.every(file => file.rootId === "producer_extension_v1"));
    assert.ok(fragment.files.some(file => file.path === PRODUCER_PACKAGE_MANIFEST));
    assert.ok(fragment.files.some(file => file.path === "dist/courseforge-producer-observer-v1.mjs"));
    assert.equal(fragment.files.length, verified.files.length);
    await assert.rejects(projectProducerExtensionInventory({...admission, rootId: "../job"}), /ROOT_ID_INVALID/);
  });

  await t.test("existing destination is not overwritten", async () => {
    await assert.rejects(buildProducerExtensionPackage({sourceDirectory, outputDirectory: first.directory, signal: signal()}), {code: "EEXIST"});
    await verifyProducerExtensionPackage(admission);
  });
  await t.test("absent or wrong independently provided digest rejects", async () => {
    await assert.rejects(verifyProducerExtensionPackage({...admission, expectedManifestSha256: undefined}), /ADMISSION_INPUT_INVALID/);
    await assert.rejects(verifyProducerExtensionPackage({...admission, expectedManifestSha256: "0".repeat(64)}), /MANIFEST_MISMATCH/);
  });
  await t.test("changed runtime rejects, and recovery requires actual original bytes", async () => {
    const path = join(first.directory, "dist/courseforge-producer-observer-v1.mjs");
    const original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from("\n// drift")]));
    await assert.rejects(verifyProducerExtensionPackage(admission), /OUTPUT_CHANGED/);
    await writeFile(path, original);
    await verifyProducerExtensionPackage(admission);
  });
  await t.test("undeclared files and missing completion marker reject", async () => {
    const extra = join(first.directory, "unexpected.txt");
    await writeFile(extra, "extra");
    await assert.rejects(verifyProducerExtensionPackage(admission), /OUTPUT_CHANGED/);
    await rm(extra);
    const marker = join(first.directory, PRODUCER_PACKAGE_MANIFEST);
    const original = await readFile(marker);
    await rm(marker);
    await assert.rejects(verifyProducerExtensionPackage(admission), {code: "ENOENT"});
    await writeFile(marker, original);
    await verifyProducerExtensionPackage(admission);
  });
});

test("destination inside vendor/node_modules and abort fail before output creation", async () => {
  await assert.rejects(buildProducerExtensionPackage({sourceDirectory, outputDirectory: join(sourceDirectory, "extension"), signal: signal()}), /DESTINATION_INVALID/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildProducerExtensionPackage({sourceDirectory, outputDirectory: join(tmpdir(), "never-created-extension"), signal: controller.signal}), {name: "AbortError"});
  await assert.rejects(buildProducerExtensionPackage({sourceDirectory, outputDirectory: join(tmpdir(), "never-created-extension")}), /SIGNAL_REQUIRED/);
});

test("snapshot rejects hardlinks and directory aliases without copying them", async t => {
  const temporary = await mkdtemp(join(tmpdir(), "courseforge-extension-alias-"));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const root = join(temporary, "root");
  await mkdir(root);
  await writeFile(join(root, "first.txt"), "fixture");
  await link(join(root, "first.txt"), join(root, "second.txt"));
  await assert.rejects(snapshotProducerPackage(root), /FILE_INVALID/);
  await rm(join(root, "second.txt"));
  const alias = join(temporary, "alias");
  await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(snapshotProducerPackage(alias), /DIRECTORY_INVALID/);
});
