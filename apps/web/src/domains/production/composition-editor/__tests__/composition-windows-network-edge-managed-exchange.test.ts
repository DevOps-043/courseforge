import test from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {createWindowsNetworkEdgeManagedExchange, type WindowsNetworkEdgeProxy} from "../qa/composition-windows-network-edge-managed-exchange";
import type {WindowsNetworkManagedExchangeRequest} from "../qa/composition-windows-network-authenticated-exchange";

const freshSignal = () => new AbortController().signal;
const request = (): WindowsNetworkManagedExchangeRequest => ({channelId: "70000000-0000-4000-8000-000000000001",
  expectedServerPid: 123, expectedServerCreationFileTime: "18446744073709551615", expectedServerSid: "S-1-5-21-1-2-3-1001",
  expectedServerLogonSid: "S-1-5-5-1-2", expectedClientPid: 456, expectedClientCreationFileTime: "133000000000000001",
  expectedClientSid: "S-1-5-21-1-2-3-1002", expectedClientLogonSid: "S-1-5-5-1-3",
  serverSourcePath: "not-passed-to-clr", clientSourcePath: "not-passed-to-clr", payload: Buffer.from("{}")});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => {resolve = accept;});
  return {promise, resolve};
}
async function adapter(factory: WindowsNetworkEdgeProxy, verify: (signal: AbortSignal) => Promise<void> = async () => {}) {
  const assemblyPath = join(process.cwd(), "operator-approved-assembly.dll");
  return createWindowsNetworkEdgeManagedExchange({assemblyPath, assertUnchanged: verify, edge: {func(options) {
    assert.deepEqual(options, {assemblyFile: assemblyPath, typeName: "Courseforge.ControlledNetwork.NetworkPipeManagedEntry", methodName: "Invoke"});
    return factory;
  }}}, freshSignal());
}

test("edge adapter uses the compiled entry and lossless captured arguments, without source evaluation", async () => {
  let checks = 0, cancels = 0;
  const input = request();
  const exchange = await adapter((received, callback) => {
    const captured = received as Record<string, unknown>;
    assert.equal(captured.expectedServerCreationFileTime, "18446744073709551615");
    assert.equal(captured.expectedClientPid, "456");
    assert.equal(Object.hasOwn(captured, "serverSourcePath"), false);
    assert.equal(Buffer.from(captured.payload as Buffer).toString(), "{}");
    callback(null, {exchange: (_unused: unknown, done: (error: unknown, value: unknown) => void) => done(null, Buffer.from("response")),
      cancel: (_unused: unknown, done: (error: unknown) => void) => {cancels++; done(null);}});
  }, async () => {checks++;});
  assert.equal(checks, 2);
  const result = await exchange(input, freshSignal());
  assert.equal(Buffer.from(result).toString(), "response");
  assert.equal(cancels, 1); assert.equal(checks, 4);
});

test("abort during managed exchange cancels once and waits for the operation to drain", async () => {
  const started = deferred<void>(), drain = deferred<void>();
  let cancels = 0, settled = false;
  const exchange = await adapter((_received, callback) => callback(null, {
    exchange: (_unused: unknown, done: (error: unknown, value: unknown) => void) => {
      started.resolve(); void drain.promise.then(() => done(null, Buffer.from("late")));
    }, cancel: (_unused: unknown, done: (error: unknown) => void) => {cancels++; done(null);}
  }));
  const abort = new AbortController();
  const result = exchange(request(), abort.signal);
  void result.then(() => {settled = true;}, () => {settled = true;});
  await started.promise; abort.abort(); await Promise.resolve();
  assert.equal(cancels, 1); assert.equal(settled, false);
  drain.resolve(); await assert.rejects(result, /RECOVERY_REQUIRED/);
  await assert.rejects(exchange(request(), freshSignal()), /RECOVERY_REQUIRED/);
});

test("abort while the factory is pending cancels the returned lease without starting native exchange", async () => {
  const started = deferred<void>(), factoryDrain = deferred<void>();
  let runs = 0, cancels = 0;
  const exchange = await adapter((_received, callback) => {
    started.resolve(); void factoryDrain.promise.then(() => callback(null, {
      exchange: (_unused: unknown, done: (error: unknown) => void) => {runs++; done(null);},
      cancel: (_unused: unknown, done: (error: unknown) => void) => {cancels++; done(null);}
    }));
  });
  const abort = new AbortController(), result = exchange(request(), abort.signal);
  await started.promise; abort.abort(); factoryDrain.resolve();
  await assert.rejects(result, /RECOVERY_REQUIRED/);
  assert.equal(runs, 0); assert.equal(cancels, 1);
});

test("cancellation callback failure discards an otherwise valid response and latches the adapter", async () => {
  let calls = 0;
  const exchange = await adapter((_received, callback) => {
    calls++; callback(null, {
      exchange: (_unused: unknown, done: (error: unknown, value: unknown) => void) => done(null, Buffer.from("response")),
      cancel: (_unused: unknown, done: (error: unknown) => void) => done(new Error("private path"))
    });
  });
  await assert.rejects(exchange(request(), freshSignal()), /^Error: CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED$/);
  await assert.rejects(exchange(request(), freshSignal()), /RECOVERY_REQUIRED/);
  assert.equal(calls, 1);
});

test("post-exchange pin failure rejects response and releases the lease", async () => {
  let checks = 0, cancels = 0;
  const exchange = await adapter((_received, callback) => callback(null, {
    exchange: (_unused: unknown, done: (error: unknown, value: unknown) => void) => done(null, Buffer.from("response")),
    cancel: (_unused: unknown, done: (error: unknown) => void) => {cancels++; done(null);}
  }), async () => {if (++checks === 4) throw new Error("private path");});
  await assert.rejects(exchange(request(), freshSignal()), /RECOVERY_REQUIRED/);
  assert.equal(cancels, 1);
});
