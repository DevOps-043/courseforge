import {createHash, randomUUID, sign, verify, KeyObject} from "node:crypto";
import {lstat, open} from "node:fs/promises";
import {join} from "node:path";
import {setTimeout as pause} from "node:timers/promises";
import {createRequire} from "node:module";
import {assertPlainDirectory, readPinnedPackageFile} from "./producer-extension-files.mjs";
import {ORIGINAL_SERVER_FILE_CHANNEL_POLICY} from "./original-server-channel-policy.mjs";

const require = createRequire(new URL("../../package.json", import.meta.url));
const {createControlledRenderDeadline} = require("./dist/composition-worker/domains/production/composition-editor/qa/composition-controlled-render-deadline.js");
export {ORIGINAL_SERVER_FILE_CHANNEL_POLICY};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = () => {throw new Error("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");};
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const encode = value => Buffer.from(JSON.stringify(value));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
function bindingCopy(binding) {
  if (!exact(binding, ["executionId", "operationNonce"]) || !uuid.test(binding.executionId) || !uuid.test(binding.operationNonce)) fail();
  return {...binding};
}
function candidateCopy(candidate) {
  if (!exact(candidate, ["serverUrl", "address", "port"]) || candidate.address !== "127.0.0.1"
    || !Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535
    || candidate.serverUrl !== `http://localhost:${candidate.port}`) fail();
  return {...candidate};
}
function assertKey(key, type) {
  if (!(key instanceof KeyObject) || key.type !== type || key.asymmetricKeyType !== "ed25519") fail();
}
function rootCopy(root) {
  if (!exact(root, ["pid", "creationFileTime"]) || !Number.isInteger(root.pid) || root.pid < 1 || root.pid > 0xffffffff
    || typeof root.creationFileTime !== "string" || !/^[1-9][0-9]{0,19}$/.test(root.creationFileTime)
    || BigInt(root.creationFileTime) > 0xffffffffffffffffn) fail();
  return {...root};
}

/** Local bounded mailbox, NOT ACL provisioning, a native network boundary, or cross-host transport.
 * Directory must be operator-owned, dedicated to this execution and retained on uncertainty.
 * No overwrite, cleanup, TTL reclaim, automatic resume, or private key supplied to the producer. */
async function mailbox(directory, binding, role) {
  await assertPlainDirectory(directory);
  const identity = await lstat(directory);
  const unchanged = async () => {
    await assertPlainDirectory(directory);
    const observed = await lstat(directory);
    if (identity.dev !== observed.dev || identity.ino !== observed.ino) fail();
  };
  const write = async (name, bytes, signal) => {
    signal.throwIfAborted(); await unchanged();
    if (bytes.length > ORIGINAL_SERVER_FILE_CHANNEL_POLICY.maximumBytes) fail();
    const handle = await open(join(directory, name), "wx", 0o600);
    try {await handle.writeFile(bytes); await handle.sync(); signal.throwIfAborted(); await unchanged();}
    finally {await handle.close();}
  };
  const read = async (name, signal) => {
    while (true) {
      signal.throwIfAborted(); await unchanged();
      let marker;
      try {marker = await readPinnedPackageFile(join(directory, `${name}.ready`), 1);}
      catch (error) {
        if (error?.code !== "ENOENT") throw error;
        await pause(ORIGINAL_SERVER_FILE_CHANNEL_POLICY.pollMilliseconds, undefined, {signal});
        continue;
      }
      if (marker.toString() !== "1") fail();
      const bytes = await readPinnedPackageFile(join(directory, name), ORIGINAL_SERVER_FILE_CHANNEL_POLICY.maximumBytes);
      signal.throwIfAborted(); await unchanged(); return bytes;
    }
  };
  // Exclusive role reservation: a fresh instance cannot silently replay a retained mailbox.
  await write(`${binding.operationNonce}.${role}.claim`, encode(binding), new AbortController().signal);
  return {read, publish: async (name, bytes, signal) => {
    await write(name, bytes, signal); await write(`${name}.ready`, Buffer.from("1"), signal);
  }};
}

async function createChannel(configuration, role) {
  const binding = bindingCopy(configuration.binding);
  let box;
  try {box = await mailbox(configuration.directory, binding, role);} catch {fail();}
  let sequence = 0, busy = false, failed = false;
  return {binding, box, run: async (signal, operation) => {
    if (busy || failed || sequence >= ORIGINAL_SERVER_FILE_CHANNEL_POLICY.maximumRequests
      || !(signal instanceof AbortSignal) || signal.aborted) fail();
    busy = true; const current = ++sequence;
    const deadline = createControlledRenderDeadline(ORIGINAL_SERVER_FILE_CHANNEL_POLICY.timeoutMilliseconds, signal);
    let inFlight;
    try {return await deadline.run(async ownedSignal => {
      inFlight = Promise.resolve().then(() => operation(current, ownedSignal));
      return inFlight;
    });}
    catch {
      failed = true;
      // Keep ownership while a noncooperative callback/native write is outstanding. The parent
      // executor bounds cleanup and quarantines its fence; no late work escapes a released fence.
      try {await inFlight;} catch { /* Retain the channel error, never publish a late grant. */ }
      fail();
    }
    finally {busy = false; deadline.dispose();}
  }};
}

/** Public key MUST come from hash-pinned operator configuration, not candidate/workspace HTML. */
export async function createOriginalServerFileClient(configuration) {
  assertKey(configuration.publicKey, "public");
  const key = configuration.publicKey;
  const channel = await createChannel(configuration, "producer");
  return async ({signal, ...rawCandidate}) => channel.run(signal, async (sequence, ownedSignal) => {
    const request = {policy: ORIGINAL_SERVER_FILE_CHANNEL_POLICY.id, ...channel.binding, sequence,
      requestId: randomUUID(), candidate: candidateCopy(rawCandidate)};
    const bytes = encode(request), prefix = `${channel.binding.operationNonce}.${sequence}`;
    await channel.box.publish(`${prefix}.request`, bytes, ownedSignal);
    const envelope = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(await channel.box.read(`${prefix}.ack`, ownedSignal)));
    if (!exact(envelope, ["payload", "signature"]) || typeof envelope.payload !== "string" || typeof envelope.signature !== "string") fail();
    const payload = Buffer.from(envelope.payload, "base64"), signature = Buffer.from(envelope.signature, "base64");
    if (payload.toString("base64") !== envelope.payload || signature.length !== 64 || signature.toString("base64") !== envelope.signature
      || !verify(null, payload, key, signature)) fail();
    const response = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(payload));
    if (!exact(response, ["requestSha256", "requestId", "executionId", "operationNonce", "sequence", "rootIdentity", "ack"])
      || response.requestSha256 !== digest(bytes) || response.requestId !== request.requestId || response.executionId !== request.executionId
      || response.operationNonce !== request.operationNonce || response.sequence !== sequence || rootCopy(response.rootIdentity).pid !== process.pid
      || !exact(response.ack, ["status", "address", "port"]) || response.ack.status !== "AUTHORIZED"
      || response.ack.address !== request.candidate.address || response.ack.port !== request.candidate.port) fail();
    ownedSignal.throwIfAborted(); return Object.freeze({...response.ack});
  });
}

/** authorize is the supervisor composition with independent owned-listener and broker checks. */
export async function createOriginalServerFileSupervisor(configuration) {
  assertKey(configuration.privateKey, "private");
  if (typeof configuration.authorize !== "function") fail();
  const key = configuration.privateKey, authorize = configuration.authorize, root = rootCopy(configuration.rootIdentity);
  const channel = await createChannel(configuration, "supervisor");
  return signal => channel.run(signal, async (sequence, ownedSignal) => {
    const prefix = `${channel.binding.operationNonce}.${sequence}`;
    const bytes = await channel.box.read(`${prefix}.request`, ownedSignal);
    const request = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    if (!exact(request, ["policy", "executionId", "operationNonce", "sequence", "requestId", "candidate"])
      || request.policy !== ORIGINAL_SERVER_FILE_CHANNEL_POLICY.id || request.executionId !== channel.binding.executionId
      || request.operationNonce !== channel.binding.operationNonce || request.sequence !== sequence || !uuid.test(request.requestId)) fail();
    const candidate = candidateCopy(request.candidate);
    const ack = await authorize(candidate, ownedSignal); ownedSignal.throwIfAborted();
    if (!exact(ack, ["status", "address", "port"]) || ack.status !== "AUTHORIZED"
      || ack.address !== candidate.address || ack.port !== candidate.port) fail();
    const payload = encode({requestSha256: digest(bytes), requestId: request.requestId, ...channel.binding, sequence, rootIdentity: root, ack});
    await channel.box.publish(`${prefix}.ack`, encode({payload: payload.toString("base64"), signature: sign(null, payload, key).toString("base64")}), ownedSignal);
    return {sequence, requestId: request.requestId};
  });
}
