import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync, randomUUID} from "node:crypto";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createOriginalServerFileClient, createOriginalServerFileSupervisor} from "./original-server-file-channel.mjs";

const candidate = {serverUrl: "http://localhost:43210", address: "127.0.0.1", port: 43210};
const signal = () => new AbortController().signal;
async function fixture(context, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "original-server-mailbox-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const keys = generateKeyPairSync("ed25519");
  const binding = {executionId: randomUUID(), operationNonce: randomUUID()};
  const clientConfig = {directory, binding, publicKey: keys.publicKey};
  const supervisorConfig = {directory, binding, privateKey: keys.privateKey,
    rootIdentity: {pid: process.pid, creationFileTime: "133000000000000001"},
    authorize: async value => ({status: "AUTHORIZED", address: value.address, port: value.port}), ...overrides};
  return {directory, clientConfig, client: await createOriginalServerFileClient(clientConfig),
    serve: await createOriginalServerFileSupervisor(supervisorConfig)};
}

test("real filesystem transport binds requests and Ed25519 ACKs without opening a network port", async context => {
  const f = await fixture(context);
  for (let sequence = 1; sequence <= 2; sequence++) {
    const [ack, handled] = await Promise.all([f.client({...candidate, signal: signal()}), f.serve(signal())]);
    assert.deepEqual(ack, {status: "AUTHORIZED", address: candidate.address, port: candidate.port});
    assert.equal(handled.sequence, sequence);
  }
  assert.equal((await readdir(f.directory)).length, 10);
  await assert.rejects(createOriginalServerFileClient(f.clientConfig), /EEXIST|RECOVERY_REQUIRED/);
});

test("producer rejects counterfeit signed ACK despite matching contents", async context => {
  const f = await fixture(context, {privateKey: generateKeyPairSync("ed25519").privateKey});
  const client = f.client({...candidate, signal: signal()});
  await f.serve(signal()); await assert.rejects(client, /RECOVERY_REQUIRED/);
  await assert.rejects(f.client({...candidate, signal: signal()}), /RECOVERY_REQUIRED/);
});

test("signed ACK from a different root PID cannot authorize this producer", async context => {
  const f = await fixture(context, {rootIdentity: {pid: process.pid + 1, creationFileTime: "133000000000000001"}});
  const client = f.client({...candidate, signal: signal()});
  await f.serve(signal()); await assert.rejects(client, /RECOVERY_REQUIRED/);
});

test("cancelled supervisor retains claims and cannot resume another request", async context => {
  const f = await fixture(context), cancellation = new AbortController();
  const pending = f.serve(cancellation.signal); cancellation.abort();
  await assert.rejects(pending, /RECOVERY_REQUIRED/);
  await assert.rejects(f.serve(signal()), /RECOVERY_REQUIRED/);
  assert.equal((await readdir(f.directory)).length, 2);
});

test("invalid producer candidate latches channel without publishing a request", async context => {
  const f = await fixture(context);
  await assert.rejects(f.client({...candidate, serverUrl: "http://evil.test:43210", signal: signal()}), /RECOVERY_REQUIRED/);
  await assert.rejects(f.client({...candidate, signal: signal()}), /RECOVERY_REQUIRED/);
  assert.equal((await readdir(f.directory)).length, 2);
});

test("cancelled supervisor drains noncooperative authorization before returning and never writes late ACK", async context => {
  let release, entered;
  const started = new Promise(resolve => {entered = resolve;});
  const gate = new Promise(resolve => {release = resolve;});
  const f = await fixture(context, {authorize: async () => {
    entered(); await gate; return {status: "AUTHORIZED", address: candidate.address, port: candidate.port};
  }});
  const cancellation = new AbortController();
  const producer = assert.rejects(f.client({...candidate, signal: cancellation.signal}), /RECOVERY_REQUIRED/);
  let settled = false;
  const supervisor = assert.rejects(f.serve(cancellation.signal), /RECOVERY_REQUIRED/).then(() => {settled = true;});
  await started; cancellation.abort();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  release(); await supervisor; await producer;
  assert.equal((await readdir(f.directory)).some(name => name.includes('.ack')), false);
});
