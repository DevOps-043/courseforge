import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assertBrowserExecutableUnchanged, BROWSER_EXECUTABLE_MAX_BYTES, browserExecutableIdentityHash,
  browserExecutableIdentitySchema, readBrowserExecutableIdentity } from "../qa/composition-browser-executable-identity";

async function withExecutable(action: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "browser-launch-identity-"));
  try { await action(join(directory, "controlled-launch-file")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("launch file bytes are hashed with exact size and no private path in identity", async () => {
  await withExecutable(async (path) => {
    const bytes = Buffer.alloc(256 * 1024, 7);
    await writeFile(path, bytes);
    const identity = await readBrowserExecutableIdentity(path);
    assert.equal(identity.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(identity.sizeBytes, bytes.length);
    assert.equal(JSON.stringify(identity).includes(path), false);
    assert.equal(browserExecutableIdentityHash(Object.fromEntries(Object.entries(identity).reverse())), browserExecutableIdentityHash(identity));
    await assertBrowserExecutableUnchanged(path, identity);
  });
});

test("equal-size replacement, truncation and removed launch file reject verification", async () => {
  await withExecutable(async (path) => {
    await writeFile(path, "original");
    const identity = await readBrowserExecutableIdentity(path);
    await writeFile(path, "modified");
    await assert.rejects(assertBrowserExecutableUnchanged(path, identity), /EXECUTABLE_CHANGED/);
    await writeFile(path, "short");
    await assert.rejects(assertBrowserExecutableUnchanged(path, identity), /EXECUTABLE_CHANGED/);
    await rm(path);
    await assert.rejects(assertBrowserExecutableUnchanged(path, identity));
  });
});

test("empty and oversized files are rejected before streaming; invalid identities fail closed", async () => {
  await withExecutable(async (path) => {
    await writeFile(path, "");
    await assert.rejects(readBrowserExecutableIdentity(path), /EXECUTABLE_INVALID/);
    const file = await open(path, "r+");
    try { await file.truncate(BROWSER_EXECUTABLE_MAX_BYTES + 1); }
    finally { await file.close(); }
    await assert.rejects(readBrowserExecutableIdentity(path), /EXECUTABLE_INVALID/);
    const valid = {policy: "LAUNCH_FILE_SHA256_BEFORE_AFTER_V1", scope: "LAUNCH_FILE_NOT_LOADED_MODULES_OR_REMOTE_RENDERER", sha256: "e".repeat(64), sizeBytes: 100};
    for (const invalid of [{...valid, sha256: "invalid"}, {...valid, sizeBytes: 0},
      {...valid, sizeBytes: BROWSER_EXECUTABLE_MAX_BYTES + 1}, {...valid, path: "private"}, {...valid, scope: "RENDERER_ATTESTED"}]) {
      assert.equal(browserExecutableIdentitySchema.safeParse(invalid).success, false);
    }
  });
});
