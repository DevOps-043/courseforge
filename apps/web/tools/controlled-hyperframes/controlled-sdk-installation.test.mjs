import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, mkdir, writeFile, rename, rm, symlink, link} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pinControlledSdkInstallation, assertControlledSdkInstallationUnchanged, SDK_INSTALLATION_POLICY} from "./controlled-sdk-installation.mjs";

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "cap027-installation-"));
  try {await run(directory);} finally {await rm(directory, {recursive: true, force: true});}
}
test("inventory preserves empty files and directories and exports no paths in its summary", async () => fixture(async root => {
  await mkdir(join(root, "empty")); await writeFile(join(root, "zero"), ""); await writeFile(join(root, "entry.js"), "export{}");
  const pin = await pinControlledSdkInstallation(root);
  assert.equal(pin.summary.fileCount, 2); assert.equal(pin.summary.entryCount, 4); assert.equal(pin.summary.sizeBytes, 8);
  assert.match(pin.summary.treeSha256, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(pin.summary).includes(root), false);
  assert.equal(Object.isFrozen(pin.entries[0].identity), true);
  await assertControlledSdkInstallationUnchanged(pin);
}));
test("secondary file mutation, addition, deletion and rename invalidate the inventory", async () => {
  for (const change of [root => writeFile(join(root, "secondary.js"), "after!"),
    root => writeFile(join(root, "injected.js"), "new"), root => rm(join(root, "secondary.js")),
    root => rename(join(root, "secondary.js"), join(root, "renamed.js"))]) await fixture(async root => {
    await writeFile(join(root, "secondary.js"), "before"); const pin = await pinControlledSdkInstallation(root);
    await change(root); await assert.rejects(assertControlledSdkInstallationUnchanged(pin), /INSTALLATION_CHANGED/);
  });
});
test("equivalent bytes in differently named files do not share identity", async () => fixture(async root => {
  await writeFile(join(root, "one"), "same"); const before = await pinControlledSdkInstallation(root);
  await rename(join(root, "one"), join(root, "two")); const after = await pinControlledSdkInstallation(root);
  assert.notEqual(before.summary.treeSha256, after.summary.treeSha256);
}));
test("entry, depth, file and aggregate budgets fail closed", async () => fixture(async root => {
  await mkdir(join(root, "sub")); await writeFile(join(root, "sub", "code"), "abcd");
  for (const overrides of [{maximumEntries: 2}, {maximumDepth: 1}, {maximumFileBytes: 3}, {maximumTotalBytes: 3}])
    await assert.rejects(pinControlledSdkInstallation(root, {limits: {...SDK_INSTALLATION_POLICY, ...overrides}}), /LIMIT_EXCEEDED/);
  await assert.rejects(pinControlledSdkInstallation(root, {limits: {...SDK_INSTALLATION_POLICY, maximumEntries: Infinity}}), /LIMIT_INVALID/);
}));
test("cancellation checks stop scanning and private filesystem errors are sanitized", async () => fixture(async root => {
  await assert.rejects(pinControlledSdkInstallation(root, {checkActive: () => {throw new Error("CONTROLLED_RENDER_ABORTED");}}), /CONTROLLED_RENDER_ABORTED/);
  await assert.rejects(pinControlledSdkInstallation(join(root, "private-missing")), error => error.message === "CONTROLLED_RENDER_INSTALLATION_READ_FAILED");
}));
test("directory junctions cannot import files outside the selected installation", async () => fixture(async root => {
  const tree = join(root, "tree"), external = join(root, "external"); await mkdir(tree); await mkdir(external);
  await writeFile(join(external, "secret"), "not inventoried");
  await symlink(external, join(tree, "escape"), "junction");
  await assert.rejects(pinControlledSdkInstallation(tree), /ENTRY_INVALID/);
}));
test("hard-linked files cannot share mutable bytes with another namespace", async () => fixture(async root => {
  const tree = join(root, "tree"), external = join(root, "external"); await mkdir(tree);
  await writeFile(external, "shared bytes"); await link(external, join(tree, "linked"));
  await assert.rejects(pinControlledSdkInstallation(tree), /ENTRY_INVALID/);
}));
