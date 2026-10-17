import test, {type TestContext} from "node:test";
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, mkdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {prepareWindowsAuthenticatedNetworkExchange} from "../qa/composition-windows-network-authenticated-exchange";
import {WINDOWS_NETWORK_CHANNEL_POLICY} from "../qa/composition-windows-network-channel-contract";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const signal = () => new AbortController().signal;
async function fixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "authenticated-exchange-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const journal = join(directory, "journal"); await mkdir(journal);
  const files = Object.fromEntries(await Promise.all(["server", "client", "loader", "invocation", "nativeLibrary"].map(async role => {
    const bytes = Buffer.from(`nonexecutable ${role}`), path = join(directory, role); await writeFile(path, bytes);
    return [role, {path, sha256: digest(bytes), sizeBytes: bytes.length}];
  })));
  const binding = {channelId: randomUUID(), operationNonce: randomUUID(), scope: {hostId: "host", organizationId: randomUUID(),
    executionId: randomUUID(), appContainerSid: "S-1-15-2-1-2-3-4-5-6-7"}};
  const configuration = {policy: "WINDOWS_NETWORK_OPERATOR_BROKER_V2", binding,
    authority: {providerId: randomUUID(), sublayerId: randomUUID()}, journalDirectory: journal, files,
    clientPeer: {pid: process.pid, creationFileTime: "133000000000000001", accountSid: "S-1-5-21-1-2-3-1001", logonSid: "S-1-5-5-1-2"},
    brokerPeer: {pid: process.pid + 1, creationFileTime: "133000000000000002", accountSid: "S-1-5-21-1-2-3-1002", logonSid: "S-1-5-5-1-3"}};
  const bytes = Buffer.from(JSON.stringify(configuration)), path = join(directory, "config.json"); await writeFile(path, bytes);
  return {configuration, reference: {path, sha256: digest(bytes)}, request: () => Buffer.from(JSON.stringify({
    policy: WINDOWS_NETWORK_CHANNEL_POLICY.id, ...binding, requestId: randomUUID(), sequence: 1, command: "DENY_BEFORE_START"}))};
}

test("admitted exchange captures native identity arguments and rejects replay without invoking another callback", async context => {
  const f = await fixture(context); let calls = 0;
  const exchange = await prepareWindowsAuthenticatedNetworkExchange(f.reference, async request => {
    calls++; assert.equal(request.expectedClientPid, process.pid);
    assert.equal(request.expectedServerCreationFileTime, f.configuration.brokerPeer.creationFileTime);
    assert.equal(request.expectedClientLogonSid, f.configuration.clientPeer.logonSid);
    assert.equal(request.channelId, f.configuration.binding.channelId); return Buffer.from("response fixture");
  }, signal());
  assert.equal(calls, 0);
  assert.equal(Buffer.from(await exchange(f.request(), signal())).toString(), "response fixture");
  await assert.rejects(exchange(f.request(), signal()), /RECOVERY_REQUIRED/); assert.equal(calls, 1);
});

test("post-invocation file drift discards response and latches exchange", async context => {
  const f = await fixture(context); let calls = 0;
  const exchange = await prepareWindowsAuthenticatedNetworkExchange(f.reference, async () => {
    calls++; await writeFile(f.configuration.files.client.path, "changed"); return Buffer.from("unpublishable");
  }, signal());
  await assert.rejects(exchange(f.request(), signal()), /RECOVERY_REQUIRED/);
  await assert.rejects(exchange(f.request(), signal()), /RECOVERY_REQUIRED/); assert.equal(calls, 1);
});

test("wrong nonce fails before managed invocation", async context => {
  const f = await fixture(context); let calls = 0;
  const exchange = await prepareWindowsAuthenticatedNetworkExchange(f.reference, async () => {calls++; return Buffer.from("unused");}, signal());
  const request = JSON.parse(f.request().toString()); request.operationNonce = randomUUID();
  await assert.rejects(exchange(Buffer.from(JSON.stringify(request)), signal()), /RECOVERY_REQUIRED/); assert.equal(calls, 0);
});
