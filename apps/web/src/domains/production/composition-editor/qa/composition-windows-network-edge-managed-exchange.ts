import {isAbsolute, resolve} from "node:path";
import type {WindowsNetworkManagedExchange, WindowsNetworkManagedExchangeRequest} from "./composition-windows-network-authenticated-exchange";
import {WINDOWS_NETWORK_CHANNEL_POLICY} from "./composition-windows-network-channel-contract";
import {admitWindowsNetworkRuntime} from "./composition-windows-network-runtime-admission";

type EdgeCallback = (error: unknown, result?: unknown) => void;
export type WindowsNetworkEdgeProxy = (input: unknown, callback: EdgeCallback) => void;
export type WindowsNetworkEdgeRuntime = {func(options: {assemblyFile: string; typeName: string; methodName: string}): WindowsNetworkEdgeProxy};
const failure = () => new Error("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");
function invoke(proxy: WindowsNetworkEdgeProxy, input: unknown): Promise<unknown> {
  return new Promise((accept, reject) => {
    try {proxy(input, (error, result) => {if (error) reject(failure()); else accept(result);});}
    catch {reject(failure());}
  });
}
function captureRequest(request: WindowsNetworkManagedExchangeRequest) {
  return {channelId: request.channelId, expectedServerPid: String(request.expectedServerPid),
    expectedServerCreationFileTime: request.expectedServerCreationFileTime, expectedServerSid: request.expectedServerSid,
    expectedServerLogonSid: request.expectedServerLogonSid, expectedClientPid: String(request.expectedClientPid),
    expectedClientCreationFileTime: request.expectedClientCreationFileTime, expectedClientSid: request.expectedClientSid,
    expectedClientLogonSid: request.expectedClientLogonSid, payload: Buffer.from(request.payload)};
}

/** Admit the complete declared bundle before edge.func binds its managed assembly. The edge
 * object must already be operator-owned: this does NOT prove where a preloaded module came
 * from or admit DLL dependencies outside the declared tree. Host verification remains required. */
export async function createAdmittedWindowsNetworkEdgeManagedExchange(input: {
  edge: WindowsNetworkEdgeRuntime; runtimeBundle: Parameters<typeof admitWindowsNetworkRuntime>[0];
  assertHostIntegrity: (signal: AbortSignal) => Promise<void>;
}, signal: AbortSignal): Promise<WindowsNetworkManagedExchange> {
  if (!input || typeof input.assertHostIntegrity !== "function") throw failure();
  const verifyHost = input.assertHostIntegrity, edge = input.edge;
  const runtime = await admitWindowsNetworkRuntime(input.runtimeBundle, signal);
  return createWindowsNetworkEdgeManagedExchange({edge, assemblyPath: runtime.paths.managedAssembly,
    assertUnchanged: async ownedSignal => {
      await runtime.assertUnchanged(ownedSignal);
      await verifyHost(ownedSignal);
      await runtime.assertUnchanged(ownedSignal);
    }}, signal);
}

/** Explicit operator activation: edge.func can load the admitted CLR assembly. Never call from
 * configuration admission, HTML or worker metadata. The operator MUST admit the full edge/native/
 * assembly dependency closure and immutable ACLs in assertUnchanged, not just this assembly path.
 * No dependency install, subprocess, source compilation, environment or module-resolution fallback. */
export async function createWindowsNetworkEdgeManagedExchange(input: {edge: WindowsNetworkEdgeRuntime;
  assemblyPath: string; assertUnchanged: (signal: AbortSignal) => Promise<void>}, signal: AbortSignal): Promise<WindowsNetworkManagedExchange> {
  if (!input || !input.edge || typeof input.edge.func !== "function" || typeof input.assertUnchanged !== "function"
    || typeof input.assemblyPath !== "string" || !isAbsolute(input.assemblyPath) || resolve(input.assemblyPath) !== input.assemblyPath
    || input.assemblyPath.startsWith("\\\\") || input.assemblyPath.includes("\0")) throw failure();
  const assertUnchanged = input.assertUnchanged, assemblyPath = input.assemblyPath;
  const edgeFunc = input.edge.func.bind(input.edge);
  signal.throwIfAborted(); await assertUnchanged(signal); signal.throwIfAborted();
  const factory = edgeFunc({assemblyFile: assemblyPath, typeName: "Courseforge.ControlledNetwork.NetworkPipeManagedEntry", methodName: "Invoke"});
  if (typeof factory !== "function") throw failure();
  await assertUnchanged(signal); signal.throwIfAborted();
  let busy = false, failed = false;
  return async (request, ownedSignal) => {
    if (busy || failed) throw failure();
    busy = true;
    let lease: {exchange: WindowsNetworkEdgeProxy; cancel: WindowsNetworkEdgeProxy} | undefined;
    let cancelling: Promise<unknown> | undefined;
    const cancel = () => {
      if (lease && !cancelling) {
        cancelling = invoke(lease.cancel, null);
        // Observe immediately; await/drain below still propagates failure.
        void cancelling.catch(() => undefined);
      }
    };
    try {
      const captured = captureRequest(request);
      ownedSignal.throwIfAborted(); await assertUnchanged(ownedSignal); ownedSignal.throwIfAborted();
      const created = await invoke(factory, captured);
      if (!created || typeof created !== "object" || Array.isArray(created)
        || Object.keys(created).sort().join(",") !== "cancel,exchange") throw failure();
      const candidate = created as Record<string, unknown>;
      if (typeof candidate.exchange !== "function" || typeof candidate.cancel !== "function") throw failure();
      lease = {exchange: candidate.exchange as WindowsNetworkEdgeProxy, cancel: candidate.cancel as WindowsNetworkEdgeProxy};
      ownedSignal.addEventListener("abort", cancel, {once: true});
      if (ownedSignal.aborted) {cancel(); ownedSignal.throwIfAborted();}
      const response = await invoke(lease.exchange, null);
      ownedSignal.throwIfAborted();
      if (!Buffer.isBuffer(response) || response.length < 1 || response.length > WINDOWS_NETWORK_CHANNEL_POLICY.maximumPayloadBytes) throw failure();
      const bytes = Uint8Array.from(response);
      await assertUnchanged(ownedSignal); ownedSignal.throwIfAborted();
      return bytes;
    } catch {failed = true; throw failure();}
    finally {
      ownedSignal.removeEventListener("abort", cancel);
      // Release even if cancellation happened while the lease factory was completing.
      cancel();
      try {if (cancelling) await cancelling; ownedSignal.throwIfAborted();}
      catch {failed = true; throw failure();}
      finally {busy = false;}
    }
  };
}
