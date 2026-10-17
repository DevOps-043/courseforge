import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync, randomUUID} from "node:crypto";
import {readFile, mkdtemp, rm, readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {hashBytes} from "./producer-extension-files.mjs";
import {parseObservedOriginalServerChannel, createObservedOriginalServerChannel} from "./observed-original-server-channel.mjs";
import {ORIGINAL_SERVER_FILE_CHANNEL_POLICY} from "./original-server-channel-policy.mjs";

const key = generateKeyPairSync("ed25519").publicKey.export({type: "spki", format: "der"});
const transport = await readFile(new URL("./original-server-file-channel.mjs", import.meta.url));
const configuration = directory => ({policy: ORIGINAL_SERVER_FILE_CHANNEL_POLICY.id, directory, executionId: randomUUID(), operationNonce: randomUUID(),
  publicKeySpki: key.toString("base64"), publicKeySha256: hashBytes(key), transportSha256: hashBytes(transport), transportSizeBytes: transport.length});

test("public-only Ed25519 metadata rejects private fields, key drift, noncanonical encoding and invalid bindings", () => {
  const valid = configuration(join(tmpdir(), "operator-channel"));
  assert.deepEqual(parseObservedOriginalServerChannel(valid), valid);
  for (const mutation of [{privateKey: "forbidden"}, {publicKeySha256: "0".repeat(64)}, {publicKeySpki: valid.publicKeySpki + "="},
    {executionId: "unknown"}, {operationNonce: "unknown"}, {transportSizeBytes: 0}, {transportSha256: "not a hash"}])
    assert.throws(() => parseObservedOriginalServerChannel({...valid, ...mutation}), /RECOVERY_REQUIRED/);
});

test("execution, canonical mailbox placement and transport hash fail before creating a producer claim", async context => {
  const parent = await mkdtemp(join(tmpdir(), "original-server-config-"));
  context.after(() => rm(parent, {recursive: true, force: true}));
  const valid = configuration(""); valid.directory = join(parent, `${valid.executionId}.original-server-channel`);
  const request = {executionId: valid.executionId, outputParentDirectory: parent};
  for (const mutation of [{executionId: randomUUID()}, {directory: parent}, {transportSha256: "0".repeat(64)}]) {
    await assert.rejects(createObservedOriginalServerChannel({...valid, ...mutation}, request, async () => {}, new AbortController().signal), /RECOVERY_REQUIRED/);
    assert.equal((await readdir(parent)).length, 0);
  }
});
